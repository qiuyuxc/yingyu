# 映屿 · 免费多用户图床

React 实现的 MIUIX 风格紧凑界面，配合通透玻璃面板。提供系统黑白、森林绿、雾蓝三种配色，以及浅色、灰黑色深色和跟随系统模式，配色与明暗模式可独立设置并保存在浏览器。基础字号为 **11px**，支持桌面和手机。

首页示例相册自动滑动淡入淡出，可手动切换或暂停，也会随页面滚动滑动淡出。悬停、键盘聚焦、页面隐藏和离开视口时暂停自动轮播；系统开启“减少动态效果”后关闭自动轮播和位移动画。卡片、弹窗、按钮及首页区块有轻量过渡。

提供官网、用户工作台和管理后台。配额由管理员分配，用户免费申请扩容，没有支付流程。外部配额接口默认关闭，可以按需接入其他服务。

源码：[qiuyuxc/yingyu](https://github.com/qiuyuxc/yingyu)。

## 一键部署

准备一台 Linux 服务器和一个指向它的域名。需要 Git、curl、OpenSSL、tar；脚本使用 Docker Engine 与 Compose v2，添加 `--install-docker` 可在缺少 Docker 时通过官方安装脚本安装。

```sh
curl -fsSL https://raw.githubusercontent.com/qiuyuxc/yingyu/main/install.sh -o yingyu-install.sh
sudo bash yingyu-install.sh install --install-docker
```

按提示填写域名、选择 HTTPS 代理并创建管理员，密码输入隐藏。默认安装到 `/opt/yingyu`；普通用户运行时默认安装到 `~/yingyu`，也可使用 `--dir /your/path`。安装会生成固定加密密钥、构建镜像、初始化管理员并等待服务健康检查通过。

可直接指定域名和代理方式：

```sh
sudo bash yingyu-install.sh install --install-docker \
  --domain images.example.com --proxy caddy
```

- `caddy`：自带 Caddy 自动申请并续期 HTTPS 证书。域名需要指向服务器，开放 TCP 80/443；UDP 443 用于 HTTP/3。
- `external`：使用已有的 Nginx、Caddy 等 HTTPS 代理，将站点转发到 `127.0.0.1:8787`。添加 `--port 18888` 可更换本机转发端口，容器内部仍使用 8787。代理应传递真实客户端地址，API 仅对本机发布端口。

配置保存在安装目录的 `.env`，权限为 `600`。重复安装和更新保留原文件及密钥；更换域名时修改其中的 `PUBLIC_URL`、`YINGYU_DOMAIN`，然后运行 `start`。使用自带 Caddy 时 `COMPOSE_PROFILES=https`，已有代理时留空。多个实例可在首次安装前设置不同的 `YINGYU_PROJECT_NAME`，并使用不同目录和本机端口。

非交互安装需要指定 `--domain`、`--proxy` 并添加 `--skip-admin`，随后在交互终端运行 `admin`；创建首位管理员前不能开放注册。脚本不通过命令参数传递管理员密码。

```sh
sudo bash /opt/yingyu/install.sh admin --dir /opt/yingyu
sudo bash /opt/yingyu/install.sh status --dir /opt/yingyu
sudo bash /opt/yingyu/install.sh logs --dir /opt/yingyu
```

### 更新与备份

```sh
sudo bash /opt/yingyu/install.sh backup --dir /opt/yingyu
sudo bash /opt/yingyu/install.sh update --dir /opt/yingyu
```

更新要求 Git 工作区干净，使用 `main` 分支的快进更新。先构建新镜像，再短暂停止应用，保存更新前的数据库、本地对象和 `.env`，然后启动新版并等待健康检查。构建或备份失败时保留原服务；开始数据库迁移后的启动失败会保留快照及新版源码，便于查看日志排查。数据库升级在启动时自动完成。

快照保存在 `backups/时间-随机标识/`，目录权限为 `700`，包含：

| 文件 | 内容 |
| --- | --- |
| `data.tar.gz` | Docker 数据卷中的 SQLite 数据库、本地图片与头像 |
| `.env` | 对应的站点配置和加密密钥 |
| `revision` | 对应的 Git 提交 |

备份时应用会短暂停止，完成后恢复运行；失败快照不会生成完整的 `data.tar.gz`。请将完整快照复制到独立的备份位置。S3、R2 和 WebDAV 中的远端对象需在对应存储另行备份，快照保存的是它们在数据库中的记录及连接配置。

需要恢复时，先停止服务，并保存当前数据。将快照中的 `.env` 放回安装目录，切换到 `revision` 记录的源码版本并构建镜像，再通过临时容器将 `data.tar.gz` 解压回 `/app/data` 数据卷，最后运行 `start`。恢复代码、数据库和加密密钥应使用同一份快照。

`stop` 停止服务并保留数据卷。脚本提供部署互斥锁，防止备份与更新同时修改同一实例。使用自己的 GitHub 分支时，可通过 `YINGYU_REPO_URL` 和 `YINGYU_BRANCH` 指定源码仓库与分支。

## 本地运行

需要 **Node.js 22.13 或更新版本**、npm。数据保存在 `data/`，默认使用本地存储，可直接运行。

```sh
npm ci
cp .env.example .env
npm run setup
npm run dev
```

`setup` 会在终端提示输入首位管理员的邮箱、名称和密码，密码输入隐藏，至少 10 个字符。已有管理员时不会覆盖账号。

访问 **http://localhost:5173**。用户注册后可上传图片，管理员登录后通过侧栏的“管理后台”管理站点。

开发前端监听 `0.0.0.0:5173`，API 默认监听 `127.0.0.1:8787`。如果通过其他主机名或 IP 访问，把 `.env` 中的 `PUBLIC_URL` 改为浏览器使用的完整站点地址；API 会校验该来源。

## 功能

- 图片：批量选择、拖拽、剪贴板粘贴、三个并发上传任务、上传进度和失败重试。支持 JPG、PNG、GIF、WebP、AVIF，默认单张 20 MB。
- 资源库：网格与列表、名称搜索、排序、公开与私密筛选、收藏、相册、批量移动和删除。
- 分享：图片直链、Markdown、HTML、BBCode。私密原图需所有者登录；管理员可通过网页登录审核。
- 账户：名称、密码、登录邮箱、外观和个人 API 令牌。更换邮箱需验证当前密码和新邮箱验证码；修改密码或邮箱会撤销其他会话和已有令牌。
- 配额：默认 1 GB，可在站点设置中调整新用户额度。用户提交所需**总配额**及用途，管理员批准、退回或直接调额。
- 后台：站点统计、用户和图片管理、扩容审核、存储管理、公告、注册开关、上传上限和操作记录。
- 公告：用户登录后才展示大公告，未登录页面不弹出；“公告中心”保存已发布的历史公告。后台独立的“公告管理”支持草稿、预览、发布、撤回、删除和图片页横条设置。只弹最新一条启用弹窗的公告；“不再弹出”按账号和当前公告版本在浏览器内记忆，内容更新后重新提醒。正文保留换行，最多 10000 字。
- 引导：每个账号在当前浏览器首次进入个人工作台时自动提供操作引导。跟随高亮控件完成进入上传页、选图、选择可见性、上传和复制链接，操作成功后自动推进；失败时停留并支持重试。可随时退出，右上角指南针可重新开启。
- 导航：手机在页面空白或非交互区域右滑打开侧栏，左滑收起；竖向滚动、输入框和横向滚动区域保留原操作。右上角头像提供账户设置和退出登录菜单。
- 头像：当前头像免费，支持最多 10 个占配额的历史头像，可直接换回。关闭头像库后历史头像保留 7 天，最后 3 天在“我的图片”页提醒；重新开启可取消到期计划。
- 统计：近七日上传使用折线图，可切换图片数和上传量，点击日期或数据点查看当天明细。

上传前用 SQLite 事务预留空间，并发上传不能超过总额度。存储删除成功后才返还空间。失败上传无法清理时保留预留空间，可在后台“未完成任务”中处理；任务停止超过 10 分钟后可清理，同一任务只能返还一次空间。

## 接入存储

进入“管理后台 → 存储管理 → 添加存储”。保存后测试连接，确认写入、读取、删除正常，再设为默认。

| 类型 | 配置 |
| --- | --- |
| 本地 | 开箱可用，对象位于 `data/objects/` |
| S3 兼容 | 服务端点、存储桶、Region、Access Key ID、Secret Access Key；MinIO 等服务可使用路径式寻址 |
| Cloudflare R2 | HTTPS 账户端点、存储桶、S3 Access Key ID 和 Secret Access Key；Region 自动使用 `auto` |
| WebDAV | 完整服务端点、存储目录、用户名、密码或应用密码 |

R2 的常规端点形如 `https://<32 位账户 ID>.r2.cloudflarestorage.com`。使用 Cloudflare R2 的 **S3 API 凭据**，授予所选存储桶的对象读写权限。配置依据：[Cloudflare AWS SDK v3 示例](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)。

图片链接统一使用本站的 `/i/:id`，默认由服务器读取存储内容，存储桶可以保持私有。

R2 和 S3 配置支持可选的 **加速域名**，例如 `https://images.example.com`，也支持 Workers 反代的路径前缀。填写后，公开图片经本站检查状态，再以不缓存的 302 跳转至“加速域名 + 对象路径”；上传和删除仍使用原 S3 API。加速域名可随时修改，已有图片链接不变。私密图片与历史头像仍通过本站鉴权读取，不跳转到加速域名。

加速域名对应的反代需自行限制私密对象访问；直接公开整个存储桶会绕过本站的访问校验，已缓存的图片也需在反代端管理缓存。参考：[Cloudflare R2 自定义域名与访问控制](https://developers.cloudflare.com/r2/buckets/public-buckets/)。

切换默认存储只影响后续上传，已有图片仍从其原存储读取。仍有图片的存储不能删除或修改其位置。后台不返回完整密钥；密钥以 AES-256-GCM 加密保存，编辑时留空保留旧值。

## SMTP 与邮件

进入“管理后台 → 邮件设置”，填写 SMTP 主机、端口、连接加密、用户名、密码或邮箱授权码、发件邮箱和名称。常用组合为 **465 + TLS** 或 **587 + STARTTLS**，填写后保存并发送测试邮件。不加密模式适用于内网 SMTP 服务。密码加密保存在数据库，后台不会回传明文，编辑时留空保留原值。

邮件服务默认关闭，配置好后可分别启用以下用途：

- 找回密码：登录页提供邮箱找回入口，重置链接 30 分钟有效且只能使用一次。完成后撤销全部登录会话、个人 API 令牌及旧重置链接。
- 注册验证：注册后直接进入 **6 位验证码** 输入页，验证码 10 分钟有效。验证成功自动登录工作台。60 秒后可重发，新验证码会替换旧验证码，错误尝试最多 5 次。未验证前不能登录或访问个人 API，原有账号和首位管理员升级后仍可正常登录。
- 更换登录邮箱：在“账户设置 → 登录邮箱”验证当前密码，再向新邮箱发送 **6 位验证码**。验证码 10 分钟有效，60 秒后可重发，最多尝试 5 次。刷新页面可继续未完成的验证，也可取消。确认前原邮箱继续有效；成功后保留当前登录，撤销其他会话、全部个人 API 令牌及旧找回链接，并向原邮箱发送通知。账户图片、头像、相册和配额保留。
- 扩容与审核：向申请人发送回执和审核结果，通知管理员处理申请，直接调额也会通知用户。审核通知可指定邮箱，留空时发给已启用的管理员。

邮件使用内置 HTML 模板，同时附带纯文本版本；动态内容会转义。邮件中的站点链接使用 `PUBLIC_URL`，因此请设置成用户实际访问的站点地址。找回密码和重发接口限制频率，返回相同提示以避免直接暴露邮箱是否已注册。验证和重置令牌仅以哈希保存，不会出现在发送日志中。

最近 100 次发送结果保留在数据库，后台展示最近 30 次。显示“服务器已接受”表示 SMTP 接受邮件；最终到达收件箱取决于邮件服务商。发送失败不会撤销配额申请或审批结果，用户可在站内查看结果。邮件验证或重置失败时可以重新申请发送。

## 头像与保留期

在“账户设置 → 头像与头像库”上传头像，单个最大 5 MB。头像存入当前默认存储，切换存储后旧头像仍从原存储读取，仍有头像的存储配置不能删除或迁移路径。

当前头像不占配额。开启头像库后，上传新头像前会预留旧头像所需的额度，完成替换后旧头像进入历史库并计入用量；切换回历史头像时，只按新旧历史头像大小的差额调账。满 10 个历史头像或额度不足时，需要先删除历史头像或扩容。未开启时，被替换的头像直接删除。

关闭头像库时，已有历史头像保留 7 天并继续占配额，之后被替换的当前头像直接删除。最后 3 天会出现可关闭的到期提醒；到期前重新开启可取消清理。服务启动和运行期间每分钟检查到期记录，删除成功后归还额度，当前头像不受影响。存储故障时保留待清理记录并自动重试，也可在头像设置中手动重试；未删除成功的历史文件仍占额度。

## 构建与启动

```sh
npm run build
PUBLIC_URL=http://localhost:8787 npm start
```

构建产物为 `dist/` 和 `dist-server/`。上述命令在 **http://localhost:8787** 同时提供前端、API 和原图，支持前端路由刷新。

线上运行时，在 `.env` 中设置：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
PUBLIC_URL=https://images.example.com
DATA_DIR=./data
ENCRYPTION_KEY=替换为固定的64位十六进制密钥
QUOTA_INTEGRATION_TOKEN=
```

生成密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

在 HTTPS 反向代理后启动服务，将该域名转发到 `127.0.0.1:8787`。`PUBLIC_URL` 决定外链地址和允许的请求来源，必须与实际地址一致。

开发环境会自动生成 `data/.encryption-key`。已有存储配置时，将它的值用于生产 `ENCRYPTION_KEY`，避免更换密钥后无法解密原凭据。备份数据目录及对应密钥；服务停止后再复制 SQLite 文件，或使用 SQLite 的备份工具。

## API 上传

在“账户设置 → API 访问令牌”创建令牌，完整令牌只展示一次。

```sh
curl 'http://localhost:5173/api/images' \
  -H 'Authorization: Bearer 你的个人令牌' \
  -F 'file=@/path/to/photo.jpg' \
  -F 'visibility=public'
```

可选 `albumId` 字段。成功返回 `{ image, user }`，其中 `image.url` 是原图链接。个人令牌只访问本人资源，管理员个人令牌也不能调用后台接口。

常用接口：

| 请求 | 用途 |
| --- | --- |
| `GET /api/images` | 图片列表，支持 `page`、`limit`、`search`、`sort`、`starred`、`albumId`、`visibility` |
| `POST /api/images` | `multipart/form-data` 上传 |
| `PATCH /api/images/:id` | 名称、收藏、相册、可见性 |
| `DELETE /api/images/:id` | 删除并返还空间 |
| `GET /api/albums` / `POST /api/albums` | 相册列表与创建 |
| `GET /api/auth/me` | 当前用户及配额 |
| `GET /api/quota/requests` / `POST /api/quota/requests` | 免费扩容申请 |

## 外部配额接口

设置 `QUOTA_INTEGRATION_TOKEN` 后启用 `POST /api/integrations/quota`。它使用独立集成凭据，与个人令牌分开。

请求头为 `Authorization: Bearer 集成凭据`，JSON 示例：

```json
{
  "eventId": "allocation-2026-001",
  "userId": "目标用户的 UUID",
  "quotaBytes": 5368709120,
  "tier": "创作额度",
  "reason": "管理员授权的外部额度分配"
}
```

`quotaBytes` 为目标**总额度**，不是增量。`eventId` 必须标识唯一的分配事件，相同事件重试返回第一次结果，避免重复执行。新额度不能低于已用与预留空间之和。代码扩展点见 `server/quota.ts` 的 `QuotaProvisioner`。

## 验证

```sh
npm test
npm run typecheck
npm run build
python3 tests/production.test.py
bash tests/install.test.sh
shellcheck install.sh tests/install.test.sh
npx playwright install chromium
npm run test:e2e
```

后端测试使用临时数据库、本地对象目录和模拟 S3/WebDAV 服务，覆盖并发配额、失败恢复、权限、审批、凭据和数据库迁移。浏览器测试分别运行桌面和手机流程，自动启动独立临时站点，验证生产构建并检查浏览器错误、横向溢出和 11px 基础字号。

部署脚本测试使用临时 Git 仓库与模拟 Docker，验证密钥保留、完整备份、更新失败恢复和互斥锁。GitHub Actions 另外运行 Node.js 22/24、桌面与手机浏览器，并使用真实 Docker Compose 验证生产容器、持久数据卷和备份流程。

浏览器测试账号只存在于临时站点，默认不生成截图。测试报告位于 `playwright-report/`；如需截图，可设置 `CAPTURE_SCREENSHOTS=1`，截图保存至 `artifacts/`。

如果机器已有可用的 Chromium，可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run test:e2e` 指定浏览器，省去重复下载。

## 项目结构

```text
src/             React 页面、组件和样式
server/          Hono API、SQLite、配额、存储和初始化
shared/          前后端共享类型
public/samples/  官网示例图片
tests/           后端测试与浏览器测试启动器
e2e/             Playwright 用户及管理员流程
deploy/          Caddy HTTPS 配置
install.sh       Docker 安装、更新、备份与管理员初始化
```
