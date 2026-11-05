# 映屿 · 免费多用户图床

React 实现的 MIUIX 风格紧凑界面，配合通透玻璃面板。提供系统黑白、森林绿、雾蓝三种配色，以及浅色、灰黑色深色和跟随系统模式，配色与明暗模式可独立设置并保存在浏览器。基础字号为 **11px**，支持桌面和手机。

首页示例相册自动滑动淡入淡出，可手动切换或暂停，也会随页面滚动滑动淡出。悬停、键盘聚焦、页面隐藏和离开视口时暂停自动轮播；系统开启“减少动态效果”后关闭自动轮播和位移动画。卡片、弹窗、按钮及首页区块有轻量过渡。

提供官网、用户工作台和管理后台。配额由管理员分配，用户免费申请扩容，没有支付流程。外部配额接口默认关闭，可以按需接入其他服务。

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
- 账户：名称、密码、外观和个人 API 令牌。修改密码撤销其他会话和已有令牌。
- 配额：默认 1 GB，可在站点设置中调整新用户额度。用户提交所需**总配额**及用途，管理员批准、退回或直接调额。
- 后台：站点统计、用户和图片管理、扩容审核、存储管理、公告、注册开关、上传上限和操作记录。
- 公告：仅出现在“我的图片”页，进入或刷新时从小圆点展开为横条，可关闭；其他工作台页面及后台不显示公告。

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

图片统一经本站的 `/i/:id` 读取，存储桶可以保持私有，浏览器无需直接访问存储服务或配置存储端的 CORS。

切换默认存储只影响后续上传，已有图片仍从其原存储读取。仍有图片的存储不能删除或修改其位置。后台不返回完整密钥；密钥以 AES-256-GCM 加密保存，编辑时留空保留旧值。

## SMTP 与邮件

进入“管理后台 → 邮件设置”，填写 SMTP 主机、端口、连接加密、用户名、密码或邮箱授权码、发件邮箱和名称。常用组合为 **465 + TLS** 或 **587 + STARTTLS**，填写后保存并发送测试邮件。不加密模式适用于内网 SMTP 服务。密码加密保存在数据库，后台不会回传明文，编辑时留空保留原值。

邮件服务默认关闭，配置好后可分别启用以下用途：

- 找回密码：登录页提供邮箱找回入口，重置链接 30 分钟有效且只能使用一次。完成后撤销全部登录会话、个人 API 令牌及旧重置链接。
- 注册验证：仅要求新注册用户验证邮箱，验证链接 24 小时有效，未验证前不能登录或访问个人 API。支持重发，重发后旧链接失效。原有账号和首位管理员升级后仍可正常登录。
- 扩容与审核：向申请人发送回执和审核结果，通知管理员处理申请，直接调额也会通知用户。审核通知可指定邮箱，留空时发给已启用的管理员。

邮件使用内置 HTML 模板，同时附带纯文本版本；动态内容会转义。邮件中的站点链接使用 `PUBLIC_URL`，因此请设置成用户实际访问的站点地址。找回密码和重发接口限制频率，返回相同提示以避免直接暴露邮箱是否已注册。验证和重置令牌仅以哈希保存，不会出现在发送日志中。

最近 100 次发送结果保留在数据库，后台展示最近 30 次。显示“服务器已接受”表示 SMTP 接受邮件；最终到达收件箱取决于邮件服务商。发送失败不会撤销配额申请或审批结果，用户可在站内查看结果。邮件验证或重置失败时可以重新申请发送。

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
npx playwright install chromium
npm run test:e2e
```

后端测试使用临时数据库、本地对象目录和模拟 S3/WebDAV 服务，覆盖并发配额、失败恢复、权限、审批、凭据和数据库迁移。浏览器测试分别运行桌面和手机流程，自动启动独立临时站点，验证生产构建并检查浏览器错误、横向溢出和 11px 基础字号。

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
```
