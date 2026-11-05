#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

TASK_SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
TASK_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TASK_ROOT"' EXIT
TASK_INSTALL="$TASK_ROOT/install with spaces"
TASK_ORIGIN="$TASK_ROOT/origin"
TASK_RESULT="$TASK_ROOT/result"
export TASK_DOCKER_LOG="$TASK_ROOT/docker.log"
export TASK_DOCKER_STATE="$TASK_ROOT/docker.state"
export TASK_IMAGE_TAG="$TASK_ROOT/image.tag"
export TASK_IMAGE_CONTAINER="$TASK_ROOT/image.container"
export TASK_IMAGE_SEQUENCE="$TASK_ROOT/image.sequence"
export TASK_VOLUME="$TASK_ROOT/volume"
mkdir -p "$TASK_ORIGIN" "$TASK_ROOT/bin" "$TASK_VOLUME/data/objects"
printf 'database fixture\n' > "$TASK_VOLUME/data/yingyu.sqlite"
printf 'uploaded image fixture\n' > "$TASK_VOLUME/data/objects/photo.jpg"
cp "$TASK_SOURCE/install.sh" "$TASK_SOURCE/compose.yaml" "$TASK_SOURCE/Dockerfile" "$TASK_ORIGIN/"
printf '.env\n.env.*\nbackups/\n' > "$TASK_ORIGIN/.gitignore"
git -C "$TASK_ORIGIN" init --quiet --initial-branch=main
git -C "$TASK_ORIGIN" config --local user.name qiuyuxc
git -C "$TASK_ORIGIN" config --local user.email qiuyuxc@users.noreply.github.com
git -C "$TASK_ORIGIN" add .
git -C "$TASK_ORIGIN" commit --quiet -m 'test: initial deployment fixture'
TASK_FIRST_REVISION="$(git -C "$TASK_ORIGIN" rev-parse HEAD)"
export YINGYU_REPO_URL="$TASK_ORIGIN"

cat > "$TASK_ROOT/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$TASK_DOCKER_LOG"
if [[ $1 == info ]]; then exit 0; fi
if [[ $1 == inspect ]]; then
  if [[ $3 == '{{.Image}}' ]]; then cat "$TASK_IMAGE_CONTAINER"; else printf 'fixture:local'; fi
  exit 0
fi
if [[ $1 == image && $2 == tag ]]; then printf '%s' "$3" > "$TASK_IMAGE_TAG"; exit 0; fi
[[ $1 == compose ]] || exit 1
shift
while [[ $1 == --project-directory || $1 == --env-file || $1 == -f ]]; do shift 2; done
case "$1" in
  version|config) ;;
  build)
    [[ ${TASK_FAIL_BUILD:-0} == 0 ]] || exit 31
    task_sequence=0
    if [[ -f $TASK_IMAGE_SEQUENCE ]]; then task_sequence="$(cat "$TASK_IMAGE_SEQUENCE")"; fi
    task_sequence=$((task_sequence + 1))
    printf '%s' "$task_sequence" > "$TASK_IMAGE_SEQUENCE"
    printf 'fixture-image-%s' "$task_sequence" > "$TASK_IMAGE_TAG" ;;
  up)
    [[ ${TASK_FAIL_UP:-0} == 0 ]] || exit 32
    printf running > "$TASK_DOCKER_STATE"
    if [[ $* != *'--no-recreate'* || ! -f $TASK_IMAGE_CONTAINER ]]; then
      cp "$TASK_IMAGE_TAG" "$TASK_IMAGE_CONTAINER"
    fi ;;
  start)
    [[ $* != *'--wait'* ]] || exit 36
    printf running > "$TASK_DOCKER_STATE" ;;
  stop) printf stopped > "$TASK_DOCKER_STATE" ;;
  ps)
    if [[ $* == *'--status running'* ]]; then
      if [[ -f $TASK_DOCKER_STATE && $(cat "$TASK_DOCKER_STATE") == running ]]; then printf 'yingyu\n'; fi
    elif [[ -f $TASK_DOCKER_STATE ]]; then printf 'fixture-container\n'; fi ;;
  run)
    if [[ $* == *'--entrypoint tar'* ]]; then
      [[ ${TASK_FAIL_TAR:-0} == 0 ]] || exit 33
      [[ $(cat "$TASK_DOCKER_STATE") == stopped ]] || exit 34
      tar -C "$TASK_VOLUME" -czf - data
    fi ;;
  logs) ;;
  *) exit 35 ;;
esac
DOCKER
chmod +x "$TASK_ROOT/bin/docker"
export PATH="$TASK_ROOT/bin:$PATH"

installer() { bash "$TASK_SOURCE/install.sh" "$@" --dir "$TASK_INSTALL" > "$TASK_RESULT" 2>&1; }
fail() { printf 'FAIL: %s\n' "$*" >&2; cat "$TASK_RESULT" >&2; exit 1; }
expect_failure() { if "$@"; then fail 'command unexpectedly succeeded'; fi; }
check() { "$@" || fail "$*"; }
passed() { printf 'PASS: %s\n' "$1"; }
archive_count() {
  local files=("$TASK_INSTALL"/backups/*/data.tar.gz)
  if [[ -f ${files[0]} ]]; then printf '%s' "${#files[@]}"; else printf 0; fi
}

installer install --domain Images.Example.test --proxy external --port 18888 --skip-admin
TASK_ENV_HASH="$(sha256sum "$TASK_INSTALL/.env")"
check test "$(stat -c %a "$TASK_INSTALL/.env")" = 600
check test "$(cat "$TASK_DOCKER_STATE")" = running
check test "$(git -C "$TASK_INSTALL" rev-parse HEAD)" = "$TASK_FIRST_REVISION"
check rg -q '^PUBLIC_URL=https://images.example.test$' "$TASK_INSTALL/.env"
check rg -q '^ENCRYPTION_KEY=[a-f0-9]{64}$' "$TASK_INSTALL/.env"
check rg -q '^YINGYU_PORT=18888$' "$TASK_INSTALL/.env"
check rg -q '^COMPOSE_PROFILES=$' "$TASK_INSTALL/.env"
if rg -q 'npm run setup:production' "$TASK_DOCKER_LOG"; then fail '--skip-admin unexpectedly initialized an administrator'; fi
passed 'fresh installation creates private production configuration and starts services'

installer install --domain changed.example.test --proxy caddy --port 19999 --skip-admin
check test "$(sha256sum "$TASK_INSTALL/.env")" = "$TASK_ENV_HASH"
passed 'repeat installation preserves the exact configuration and encryption key'

expect_failure installer install --domain 'images.example.test/invalid' --proxy external --skip-admin
expect_failure installer install --domain images.example.test --proxy external --port 65536 --skip-admin
expect_failure installer admin
check test "$(sha256sum "$TASK_INSTALL/.env")" = "$TASK_ENV_HASH"
passed 'invalid options and noninteractive administrator setup fail without changing configuration'

bash "$TASK_SOURCE/install.sh" install --dir "$TASK_ROOT/caddy" --domain images.example.test --proxy caddy --skip-admin > "$TASK_RESULT" 2>&1
check rg -q '^COMPOSE_PROFILES=https$' "$TASK_ROOT/caddy/.env"
passed 'Caddy mode enables the HTTPS profile'

# shellcheck disable=SC2016 # Deliberately write a literal shell expression.
printf '\nUNUSED=$(touch "%s")\n' "$TASK_ROOT/env-was-executed" >> "$TASK_INSTALL/.env"
installer status
check test ! -e "$TASK_ROOT/env-was-executed"
TASK_ENV_HASH="$(sha256sum "$TASK_INSTALL/.env")"
passed 'dotenv values never execute shell commands'

installer backup
TASK_ARCHIVES=("$TASK_INSTALL"/backups/*/data.tar.gz)
TASK_BACKUP="${TASK_ARCHIVES[0]%/data.tar.gz}"
check test "$(stat -c %a "$TASK_BACKUP")" = 700
check cmp "$TASK_INSTALL/.env" "$TASK_BACKUP/.env"
check test "$(cat "$TASK_BACKUP/revision")" = "$TASK_FIRST_REVISION"
check test "$(tar -xOzf "$TASK_BACKUP/data.tar.gz" data/objects/photo.jpg)" = 'uploaded image fixture'
check test "$(cat "$TASK_DOCKER_STATE")" = running
passed 'backup captures local objects and matching configuration, then restarts the writer'

TASK_BEFORE_BACKUPS="$(archive_count)"
export TASK_FAIL_TAR=1
expect_failure installer backup
unset TASK_FAIL_TAR
check test "$(archive_count)" = "$TASK_BEFORE_BACKUPS"
check test "$(cat "$TASK_DOCKER_STATE")" = running
passed 'failed backups restart the existing service and are never marked complete'

printf 'second release\n' > "$TASK_ORIGIN/release.txt"
git -C "$TASK_ORIGIN" add release.txt
git -C "$TASK_ORIGIN" commit --quiet -m 'test: next release'
TASK_SECOND_REVISION="$(git -C "$TASK_ORIGIN" rev-parse HEAD)"
installer update
check test "$(git -C "$TASK_INSTALL" rev-parse HEAD)" = "$TASK_SECOND_REVISION"
check test "$(sha256sum "$TASK_INSTALL/.env")" = "$TASK_ENV_HASH"
check test "$(archive_count)" -eq "$((TASK_BEFORE_BACKUPS + 1))"
check test "$(cat "$TASK_DOCKER_STATE")" = running
passed 'updates build before stopping, snapshot the previous release and preserve credentials'

printf 'local edit\n' >> "$TASK_INSTALL/release.txt"
expect_failure installer update
check rg -q 'local edit' "$TASK_INSTALL/release.txt"
git -C "$TASK_INSTALL" restore release.txt
passed 'updates refuse local changes without discarding them'

printf 'third release\n' > "$TASK_ORIGIN/release.txt"
git -C "$TASK_ORIGIN" add release.txt
git -C "$TASK_ORIGIN" commit --quiet -m 'test: third release'
TASK_THIRD_REVISION="$(git -C "$TASK_ORIGIN" rev-parse HEAD)"
export TASK_FAIL_BUILD=1
expect_failure installer update
unset TASK_FAIL_BUILD
check test "$(git -C "$TASK_INSTALL" rev-parse HEAD)" = "$TASK_SECOND_REVISION"
check test "$(cat "$TASK_DOCKER_STATE")" = running
check test "$(sha256sum "$TASK_INSTALL/.env")" = "$TASK_ENV_HASH"
passed 'build failures restore the previous checkout while the old service stays online'

export TASK_FAIL_TAR=1
expect_failure installer update
unset TASK_FAIL_TAR
check test "$(git -C "$TASK_INSTALL" rev-parse HEAD)" = "$TASK_SECOND_REVISION"
check test "$(cat "$TASK_DOCKER_STATE")" = running
check cmp "$TASK_IMAGE_TAG" "$TASK_IMAGE_CONTAINER"
passed 'an update snapshot failure restores the previous checkout and service'

export TASK_FAIL_UP=1
expect_failure installer update
unset TASK_FAIL_UP
check test "$(git -C "$TASK_INSTALL" rev-parse HEAD)" = "$TASK_THIRD_REVISION"
check test "$(sha256sum "$TASK_INSTALL/.env")" = "$TASK_ENV_HASH"
check rg -q '未通过健康检查' "$TASK_RESULT"
# Random suffixes do not sort chronologically when snapshots share a second.
TASK_LAST_BACKUP="$(sed -n 's/^备份已保存：//p' "$TASK_RESULT")"
check test -f "$TASK_LAST_BACKUP/data.tar.gz"
check test "$(cat "$TASK_LAST_BACKUP/revision")" = "$TASK_SECOND_REVISION"
installer start
check test "$(cat "$TASK_DOCKER_STATE")" = running
passed 'startup failures keep the pre-migration snapshot and permit an explicit restart'

printf 'deployment lock' > "$TASK_ROOT/lock-result"
exec {TASK_TEST_LOCK}>"$TASK_INSTALL.deploy.lock"
flock "$TASK_TEST_LOCK"
expect_failure installer backup
check rg -q '另一个部署任务' "$TASK_RESULT"
flock -u "$TASK_TEST_LOCK"
passed 'concurrent mutations cannot enter the same deployment'
