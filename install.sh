#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

YINGYU_ACTION=install
YINGYU_DIR="${YINGYU_INSTALL_DIR:-/opt/yingyu}"
if [[ $EUID -ne 0 && -z ${YINGYU_INSTALL_DIR:-} ]]; then YINGYU_DIR="$HOME/yingyu"; fi
YINGYU_REPO_URL="${YINGYU_REPO_URL:-https://github.com/qiuyuxc/yingyu.git}"
YINGYU_BRANCH="${YINGYU_BRANCH:-main}"
YINGYU_DOMAIN=
YINGYU_PROXY=
YINGYU_PORT=8787
YINGYU_SKIP_ADMIN=0
YINGYU_INSTALL_DOCKER=0
YINGYU_RESTART=0
YINGYU_ROLLBACK_REVISION=
YINGYU_PREVIOUS_IMAGE=
YINGYU_PREVIOUS_IMAGE_NAME=
YINGYU_TEMP_FILE=
YINGYU_BACKUP_PATH=

die() { printf '错误：%s\n' "$*" >&2; exit 1; }
require() { command -v "$1" >/dev/null 2>&1 || die "缺少 $1，请先安装。"; }
usage() {
  cat <<'HELP'
映屿部署工具

bash install.sh [install|update|backup|admin|start|stop|status|logs] [选项]

  --dir PATH         安装目录，默认 /opt/yingyu；普通用户默认 ~/yingyu
  --domain DOMAIN    首次安装的站点域名，例如 images.example.com
  --proxy caddy      自动申请 HTTPS 证书，需要域名指向本机并开放 80/443
  --proxy external   使用已有的 HTTPS 反向代理，转发到 127.0.0.1:8787
  --port PORT        本机转发端口，默认 8787
  --skip-admin       暂不创建管理员，之后运行 admin 命令
  --install-docker   缺少 Docker 时使用官方安装脚本安装
  -h, --help         显示帮助

首次安装会生成固定加密密钥并提示创建管理员。重复安装和更新保留 .env。
更新前自动备份数据库、本地对象与 .env；远端对象需在对应存储另行备份。
HELP
}

if [[ $# -gt 0 && $1 != -* ]]; then YINGYU_ACTION="$1"; shift; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir|--domain|--proxy|--port)
      [[ $# -ge 2 && -n $2 ]] || die "$1 需要一个值"
      case "$1" in
        --dir) YINGYU_DIR="$2" ;;
        --domain) YINGYU_DOMAIN="$2" ;;
        --proxy) YINGYU_PROXY="$2" ;;
        --port) YINGYU_PORT="$2" ;;
      esac
      shift 2 ;;
    --skip-admin) YINGYU_SKIP_ADMIN=1; shift ;;
    --install-docker) YINGYU_INSTALL_DOCKER=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知选项：$1" ;;
  esac
done
case "$YINGYU_ACTION" in install|update|backup|admin|start|stop|status|logs) ;; *) die "未知命令：$YINGYU_ACTION" ;; esac
if [[ ! $YINGYU_PORT =~ ^[0-9]{1,5}$ ]] || ((10#$YINGYU_PORT < 1 || 10#$YINGYU_PORT > 65535)); then die '端口必须在 1–65535 之间'; fi
[[ -z $YINGYU_PROXY || $YINGYU_PROXY == caddy || $YINGYU_PROXY == external ]] || die '--proxy 只能是 caddy 或 external'

validate_domain() {
  [[ ${#1} -le 253 && $1 =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ ]] || die '请填写域名，不含协议、端口或路径'
}
if [[ -n $YINGYU_DOMAIN ]]; then validate_domain "$YINGYU_DOMAIN"; fi

require git
require realpath
YINGYU_DIR="$(realpath -m -- "$YINGYU_DIR")"
[[ $YINGYU_DIR != / && $YINGYU_DIR != "$HOME" ]] || die '请选择独立的安装目录'
compose() { docker compose --project-directory "$YINGYU_DIR" --env-file "$YINGYU_DIR/.env" -f "$YINGYU_DIR/compose.yaml" "$@"; }
resume_writer() {
  # Compose versions that support `up --wait` may not support it on `start`.
  # Keep the existing container and image when resuming after a snapshot.
  compose up -d --no-recreate --no-build --wait --wait-timeout 180 yingyu
}
cleanup() {
  local result=$?
  if [[ $result -ne 0 && -n $YINGYU_ROLLBACK_REVISION ]]; then
    git -C "$YINGYU_DIR" reset --keep "$YINGYU_ROLLBACK_REVISION" >/dev/null || printf '请检查更新前的版本：%s\n' "$YINGYU_ROLLBACK_REVISION" >&2
    if [[ -n $YINGYU_PREVIOUS_IMAGE && -n $YINGYU_PREVIOUS_IMAGE_NAME ]]; then
      docker image tag "$YINGYU_PREVIOUS_IMAGE" "$YINGYU_PREVIOUS_IMAGE_NAME" || printf '请检查更新前的镜像：%s\n' "$YINGYU_PREVIOUS_IMAGE" >&2
    fi
  fi
  if [[ $YINGYU_RESTART == 1 ]]; then
    resume_writer >&2 || printf '请运行 start 命令重新启动服务。\n' >&2
  fi
  if [[ -n $YINGYU_TEMP_FILE ]]; then rm -f -- "$YINGYU_TEMP_FILE"; fi
  return "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! command -v docker >/dev/null 2>&1; then
  [[ $YINGYU_ACTION == install && $YINGYU_INSTALL_DOCKER == 1 ]] || die '请安装 Docker Engine 和 Compose v2，或在安装命令中添加 --install-docker'
  require curl
  YINGYU_TEMP_FILE="$(mktemp)"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://get.docker.com --output "$YINGYU_TEMP_FILE"
  if [[ $EUID == 0 ]]; then sh "$YINGYU_TEMP_FILE"; else require sudo; sudo sh "$YINGYU_TEMP_FILE"; fi
  rm -f -- "$YINGYU_TEMP_FILE"; YINGYU_TEMP_FILE=
fi
docker compose version >/dev/null || die '需要 Docker Compose v2'
docker info >/dev/null 2>&1 || die 'Docker 服务不可用；请启动 Docker 并确认当前用户有访问权限'

if [[ $YINGYU_ACTION != status && $YINGYU_ACTION != logs ]]; then
  require flock
  mkdir -p -- "$(dirname -- "$YINGYU_DIR")"
  exec {YINGYU_LOCK_FD}>"$YINGYU_DIR.deploy.lock"
  flock -n "$YINGYU_LOCK_FD" || die '另一个部署任务正在运行'
fi

canonical_remote() {
  local remote="${1%/}"
  remote="${remote%.git}"
  remote="${remote/#git@github.com:/https://github.com/}"
  printf '%s' "$remote"
}
check_checkout() {
  [[ -f $YINGYU_DIR/compose.yaml && -f $YINGYU_DIR/Dockerfile ]] || die '此目录不是映屿部署目录'
  local root remote
  root="$(git -C "$YINGYU_DIR" rev-parse --show-toplevel)" || die '安装目录需要保留 Git 仓库'
  [[ $(realpath -- "$root") == "$YINGYU_DIR" ]] || die '请选择映屿仓库所在目录'
  remote="$(git -C "$YINGYU_DIR" remote get-url origin)" || die '缺少 origin 远端'
  [[ $(canonical_remote "$remote") == "$(canonical_remote "$YINGYU_REPO_URL")" ]] || die '该目录的 Git 远端不匹配；使用 YINGYU_REPO_URL 指定自己的映屿分支'
}
# Read only the value: dotenv files are never evaluated as shell scripts.
env_value() {
  local line value
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $line == "$1="* ]]; then
      value="${line#*=}"; value="${value%$'\r'}"
      if [[ $value == \"*\" || $value == \'*\' ]]; then value="${value:1:${#value}-2}"; fi
      printf '%s' "$value"; return
    fi
  done < "$YINGYU_DIR/.env"
}
check_config() {
  [[ -f $YINGYU_DIR/.env ]] || die '缺少 .env，请先运行 install'
  local key url
  key="$(env_value ENCRYPTION_KEY)"
  url="$(env_value PUBLIC_URL)"
  [[ $key =~ ^[a-fA-F0-9]{64}$ ]] || die '.env 需要固定的 64 位十六进制 ENCRYPTION_KEY；已有数据时必须使用原密钥'
  [[ $url == https://* ]] || die '.env 中 PUBLIC_URL 必须是用户实际访问的 HTTPS 地址'
  chmod 600 "$YINGYU_DIR/.env"
  compose config --quiet
}
configure() {
  if [[ -f $YINGYU_DIR/.env ]]; then check_config; return; fi
  require openssl
  if [[ -z $YINGYU_DOMAIN ]]; then
    [[ -t 0 ]] || die '非交互安装需要 --domain 和 --proxy，并使用 --skip-admin'
    read -r -p '站点域名（如 images.example.com）：' YINGYU_DOMAIN
  fi
  validate_domain "$YINGYU_DOMAIN"
  if [[ -z $YINGYU_PROXY ]]; then
    [[ -t 0 ]] || die '请使用 --proxy caddy 或 --proxy external'
    read -r -p 'HTTPS 代理方式（caddy / external，默认 caddy）：' YINGYU_PROXY
    YINGYU_PROXY="${YINGYU_PROXY:-caddy}"
  fi
  [[ $YINGYU_PROXY == caddy || $YINGYU_PROXY == external ]] || die '代理方式只能是 caddy 或 external'
  local key profiles project
  key="$(openssl rand -hex 32)"
  profiles=
  if [[ $YINGYU_PROXY == caddy ]]; then profiles=https; fi
  project="${YINGYU_PROJECT_NAME:-yingyu}"
  [[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die 'YINGYU_PROJECT_NAME 只能包含小写字母、数字、下划线和连字符'
  YINGYU_TEMP_FILE="$(mktemp "$YINGYU_DIR/.env.XXXXXX")"
  cat > "$YINGYU_TEMP_FILE" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
PUBLIC_URL=https://${YINGYU_DOMAIN,,}
DATA_DIR=./data
ENCRYPTION_KEY=$key
QUOTA_INTEGRATION_TOKEN=
TRUST_PROXY=1
YINGYU_PORT=$((10#$YINGYU_PORT))
YINGYU_DOMAIN=${YINGYU_DOMAIN,,}
COMPOSE_PROFILES=$profiles
COMPOSE_PROJECT_NAME=$project
ENV
  mv -- "$YINGYU_TEMP_FILE" "$YINGYU_DIR/.env"; YINGYU_TEMP_FILE=
  check_config
}
initialize_admin() {
  if [[ -t 0 ]]; then
    compose run --rm --no-deps yingyu npm run setup:production
  else
    die '管理员初始化需要交互终端；非交互安装请加 --skip-admin，之后运行 admin 命令'
  fi
}
snapshot() {
  require tar
  [[ -n $(compose ps --all --quiet yingyu) ]] || die '没有已部署的服务，请先运行 install'
  mkdir -p "$YINGYU_DIR/backups"
  YINGYU_BACKUP_PATH="$(mktemp -d "$YINGYU_DIR/backups/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
  cp -- "$YINGYU_DIR/.env" "$YINGYU_BACKUP_PATH/.env"
  printf '%s\n' "$1" > "$YINGYU_BACKUP_PATH/revision"
  if [[ $(compose ps --status running --services yingyu) == yingyu ]]; then
    YINGYU_RESTART=1
    compose stop yingyu
  fi
  # Stop the writer first so the SQLite database and WAL are one consistent snapshot.
  # Override the entrypoint to avoid starting the application or running migrations.
  if ! compose run --rm --no-deps -T --entrypoint tar yingyu -C /app -czf - data > "$YINGYU_BACKUP_PATH/data.tar.gz.partial"; then
    rm -f "$YINGYU_BACKUP_PATH/data.tar.gz.partial"
    die "备份失败，服务将恢复启动：$YINGYU_BACKUP_PATH"
  fi
  tar -tzf "$YINGYU_BACKUP_PATH/data.tar.gz.partial" >/dev/null
  mv "$YINGYU_BACKUP_PATH/data.tar.gz.partial" "$YINGYU_BACKUP_PATH/data.tar.gz"
  printf '备份已保存：%s\n' "$YINGYU_BACKUP_PATH"
}

case "$YINGYU_ACTION" in
  install)
    if [[ $YINGYU_SKIP_ADMIN == 0 && ! -t 0 ]]; then die '请在交互终端安装，或加 --skip-admin 后单独运行 admin'; fi
    if [[ ! -d $YINGYU_DIR ]]; then
      git clone --branch "$YINGYU_BRANCH" --single-branch -- "$YINGYU_REPO_URL" "$YINGYU_DIR"
    elif [[ -z $(ls -A "$YINGYU_DIR") ]]; then
      git clone --branch "$YINGYU_BRANCH" --single-branch -- "$YINGYU_REPO_URL" "$YINGYU_DIR"
    fi
    check_checkout
    configure
    compose build --pull yingyu
    if [[ $YINGYU_SKIP_ADMIN == 0 ]]; then initialize_admin; fi
    compose up -d --wait --wait-timeout 180
    printf '映屿已启动：%s\n' "$(env_value PUBLIC_URL)"
    if [[ $YINGYU_SKIP_ADMIN == 1 ]]; then printf '首次注册前，请运行：bash %q/install.sh admin --dir %q\n' "$YINGYU_DIR" "$YINGYU_DIR"; fi
    ;;
  update)
    check_checkout; check_config
    [[ -z $(git -C "$YINGYU_DIR" status --porcelain) ]] || die '仓库有本地修改，请先保存后再更新；.env 和 backups 不受影响'
    [[ $(git -C "$YINGYU_DIR" symbolic-ref --short HEAD) == "$YINGYU_BRANCH" ]] || die "请先切换到 $YINGYU_BRANCH 分支"
    YINGYU_OLD_REVISION="$(git -C "$YINGYU_DIR" rev-parse HEAD)"
    YINGYU_CONTAINER="$(compose ps --all --quiet yingyu)"
    [[ -n $YINGYU_CONTAINER ]] || die '没有已部署的服务，请先运行 install'
    YINGYU_PREVIOUS_IMAGE="$(docker inspect --format '{{.Image}}' "$YINGYU_CONTAINER")"
    YINGYU_PREVIOUS_IMAGE_NAME="$(docker inspect --format '{{.Config.Image}}' "$YINGYU_CONTAINER")"
    git -C "$YINGYU_DIR" fetch origin "$YINGYU_BRANCH"
    git -C "$YINGYU_DIR" merge-base --is-ancestor "$YINGYU_OLD_REVISION" FETCH_HEAD || die '本地历史与远端分叉，请先处理 Git 分支'
    YINGYU_ROLLBACK_REVISION="$YINGYU_OLD_REVISION"
    git -C "$YINGYU_DIR" merge --ff-only FETCH_HEAD
    compose build --pull yingyu
    snapshot "$YINGYU_OLD_REVISION"
    # From this point the new application may migrate the database. Keep the new
    # revision and snapshot on failure instead of blindly restoring older data.
    YINGYU_ROLLBACK_REVISION=
    if ! compose up -d --wait --wait-timeout 180; then
      YINGYU_RESTART=0
      die "新版未通过健康检查，请运行 logs 排查；更新前的数据与密钥保存在 $YINGYU_BACKUP_PATH"
    fi
    YINGYU_RESTART=0
    printf '更新完成：%s\n' "$(git -C "$YINGYU_DIR" rev-parse --short HEAD)"
    ;;
  backup)
    check_checkout; check_config
    snapshot "$(git -C "$YINGYU_DIR" rev-parse HEAD)"
    if [[ $YINGYU_RESTART == 1 ]]; then resume_writer; YINGYU_RESTART=0; fi
    ;;
  admin) check_checkout; check_config; initialize_admin ;;
  start) check_checkout; check_config; compose up -d --wait --wait-timeout 180 ;;
  stop) check_checkout; check_config; compose stop ;;
  status) check_checkout; check_config; compose ps ;;
  logs) check_checkout; check_config; compose logs --follow --tail 100 ;;
esac
