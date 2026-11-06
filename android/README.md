# 映屿 Android

Kotlin + Jetpack Compose + Miuix 原生客户端。支持 Android 8.0（API 26）及以上；Android 13+ 的悬浮底栏使用 [AndroidLiquidGlassView](https://github.com/QmDeve/AndroidLiquidGlassView) 实时取样、折射和模糊。旧系统使用半透明圆角底栏，“我的 → 应用设置 → 外观 → 减少透明”也可关闭效果。

排版参考网页工作台的紧凑尺寸：正文 11sp、辅助文字 9–10sp、分区标题 13sp、页面标题 22sp；普通按钮 32dp、筛选按钮 28dp、单行输入框约 36dp、底部栏 54dp。卡片内边距为 14dp，页面横向留白为 16dp，区块间距为 12dp。尺寸集中在 `Design.kt` 的 `AppType` / `AppSpacing` 中，字体仍遵循 Android 系统字号设置。输入框使用独立的小号标签，避免 Miuix 固定 17sp 浮动标签撑大组件。页面切换、列表项目、公告横条、可展开设置、弹窗和进度条提供过渡；应用设置可减少页面及弹窗动效。

首次默认使用系统黑白配色，浅色和深色的背景、面板、文字、按钮、输入框及禁用态都采用中性灰阶；深色使用柔和灰色文字及中等字重标题。仍可选择森林绿与雾蓝，已有配色选择继续保留。底部标签栏支持左右拖动，选中指示跟随手指预览，松手后切换页面，取消手势时回到原标签。

## 使用

先将站点后端更新到包含本目录的版本并重启。首次打开 App，填写站点的 **HTTPS 根地址**（例如 `https://images.example.com`），使用原有账号登录或注册。支持自建站点；不内置服务器地址、账号或密钥。

本地联调可在仓库根目录运行 `npm run build`，然后运行 `npm run preview:local`。它会启动后台测试服务，打印局域网地址和测试账号文件位置，并准备示例图片、相册及待审核的扩容申请。数据独立保存在 `data/local-app-preview/`。使用 `npm run preview:local -- status` 查看状态，`npm run preview:local -- stop` 停止服务；再次启动保留测试数据。可用 `PREVIEW_PUBLIC_URL` 和 `PREVIEW_PORT` 指定地址与端口，填写的地址应能从手机访问。

**Debug 测试包**允许 `http://127.0.0.1:端口`、`localhost`、`::1` 和私有局域网 IPv4 地址；正式 Release 包仍要求 HTTPS。手机和开发机不在同一台设备时，请填写脚本打印的局域网地址并连接同一网络。网站与 App 使用相同的站点地址，以保证私密图片和登录来源匹配。

登录页将品牌、网页已有的示例照片、表单和说明组织成连续的内容区，避免把小组件分散到屏幕上下。键盘弹出或可用高度不足时收起照片区域，小屏、较长注册表单和大系统字号可自然滚动。已保存的站点显示为简洁信息行，可点击“更换”编辑；密码支持显隐，登录错误显示在表单内。示例照片只用于界面展示，来源与 Unsplash 许可保存在 `licenses/samples.txt`，同时包含在 App 的离线许可声明中。

图库使用 4:3 缩略图，搜索与可见性筛选集中在顶部，排序和网格/列表视图通过菜单选择。长按图片或点击更多按钮可查看详情、复制、分享、收藏、移动到相册、删除及进入多选；多选支持批量移动、可见性、收藏、复制与删除，失败项目保留供重试。管理员只展示允许的操作。图片详情将分享和编辑分为两个页签，弹窗使用不透明表面，标题与操作区固定，正文独立滚动；支持双指缩放、缩放后拖动、双击放大与还原，变换限制在预览区域内。卡片、底部导航及按钮的触摸反馈裁剪到圆角范围。

图片详情采用淡入，避免整块容器扩张，滚动边缘用渐变过渡衔接固定标题和操作区，取消硬分割线。普通弹窗只保留轻微缩放，并关闭系统窗体的叠加动画。弹窗和操作菜单移除外扩投影及原生窗口的阴影区域，使用圆角描边区分边界；菜单只做淡入。

默认正文颜色在主题根部明确提供，切换深浅色及配色时同步更新。按钮仍继承自身表面的对应文字颜色，保持亮色主按钮和深色普通按钮的对比度。

图库、相册内容和公告历史连续向下浏览，接近末尾时自动接续加载，界面不提供翻页按钮。支持下拉刷新，后续请求失败保留原内容并提供原地重试。切换标签或旋转保留已加载内容与滚动状态；修改深处图片后刷新已加载范围，避免丢失后面的内容。切换账户清除内存列表并取消旧请求。相册目录使用懒加载列表，并提供真实封面、创建、重命名及删除。新封面和重命名需要同步更新后端。

“我的”提供个人资料、空间、公告中心、应用设置和管理员入口。账户设置将昵称与头像放在同一资料区域，登录邮箱与密码位于账户安全，历史头像及 API 令牌按需展开。子页面按进入路径返回，相册内容返回相册目录。头像保留、历史切换、清理重试与到期提醒均保留。

公告包括登录后最新弹窗、图片页横条、未读标记、完整正文、连续浏览历史和全部已读。“不再弹出”按站点、账号、公告与版本保存在本机；公告更新后再次提醒。横条关闭后按内容记忆，内容更新后重新展示。应用设置可关闭公告弹窗。公告同步在登录或恢复 App 时执行，未登录时不展示。独立的本地测试站点预置弹窗、横条及历史公告以便验收。

底部四个入口：

- **图片**：连续浏览、下拉刷新、网格/列表、搜索、公开/私密/收藏筛选、排序、长按菜单、多选、缩放预览、编辑、收藏、保存、复制与系统分享。
- **相册**：真实封面、创建、重命名、连续浏览内容、删除相册；删除相册保留图片。
- **上传**：系统照片选择器、多图队列、最多三个并发任务、进度、单项及批量重试、相册与可见性设置、直链/Markdown/HTML/BBCode 复制；支持从其他应用分享图片到映屿。
- **我的**：个人资料与账户安全、空间与扩容、公告中心、应用设置、使用帮助；头像与昵称一起编辑，邮箱与密码归到账户安全，历史头像与 API 令牌置于账户内。

管理员在“我的 → 管理工作台”中查看基础统计、搜索并删除全站图片、批准或退回扩容申请。存储、SMTP、站点设置和用户权限管理仍使用网页。后端按请求方法和路径限制 App 管理能力，普通账号与个人 API 令牌均不能调用管理接口。

上传任务在 ViewModel 中管理，切换 App 页面和旋转屏幕可继续；**当前不提供被系统杀进程后的后台续传**。退出账户会取消任务。未完成任务的暂存文件在应用私有缓存中；已完成或手动移除的文件会删除。请在上传完成前保持 App 运行。

## 构建

需要 JDK 21、Android SDK Platform `37.0`、Build Tools `37.0.0`。版本固定于 Gradle 配置：AGP 9.4.1、Kotlin 2.4.20、Miuix 0.9.4、LiquidGlass 1.1.0。

用 Android Studio 打开 `android/`，或创建仅本机使用的 `local.properties`：

```properties
sdk.dir=/your/android-sdk
```

```sh
cd android
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

安装包：`app/build/outputs/apk/debug/app-debug.apk`。Debug APK 使用开发签名，供测试安装；正式分发前应配置自己的发布签名并保管签名文件。仓库不包含签名密钥。

当前机器使用 ARM64 / Termux 工具链时，可通过命令参数指定其原生 aapt2，**不需要修改共享 Gradle 配置**：

```sh
gradle --no-daemon -Pandroid.aapt2FromMavenOverride=/data/data/com.termux/files/usr/bin/aapt2 :app:assembleDebug
```

## 会话与 API

App 不使用浏览器 Cookie；独立 Bearer 会话有效期 30 天，到期前一天自动续期并轮换。数据库仅保存令牌哈希，Android 用 Keystore AES-GCM 加密保存令牌，文件排除在备份之外。密码不会保存在本机。退出、密码修改、邮箱变更、账号停用和权限变更均撤销对应会话。私密图片不写入磁盘图片缓存；切换账户清理该账户的内存图片缓存。向图片加速域名跳转时不转发登录凭据。

匿名接口均接受 `Content-Type: application/json`，不携带 Cookie；若请求携带 Origin，必须与站点配置一致。限流、注册开关、验证码校验与网页共用。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `/api/mobile/v1/capabilities` | GET | 协议版本和 App 管理功能范围 |
| `/api/mobile/v1/auth/login` | POST | 邮箱、密码登录 |
| `/api/mobile/v1/auth/register` | POST | 注册；需要邮箱验证时暂不签发会话 |
| `/api/mobile/v1/auth/verify-email` | POST | 验证六位验证码并签发会话 |
| `/api/mobile/v1/auth/resend-verification` | POST | 重发验证码 |
| `/api/mobile/v1/auth/forgot-password` | POST | 发送找回邮件 |
| `/api/mobile/v1/auth/reset-password` | POST | 使用邮件令牌重置密码 |
| `/api/mobile/v1/auth/refresh` | POST | 使用有效 App Bearer 会话轮换令牌 |
| `/api/mobile/v1/auth/logout` | POST | 撤销当前 App 会话 |

成功登录/注册/验证返回 `{ user, session: { accessToken, tokenType: "Bearer", expiresAt } }`；需验证邮箱时返回 `{ verificationRequired: true, email, delivered }`。密码和邮箱变更也会返回新 `session`，客户端替换旧令牌。已过期的会话需要重新登录。

图片、相册、账户、配额和公告继续使用现有 `/api/...` 接口，发送 `Authorization: Bearer <accessToken>`。管理员 App 会话仅可访问：

```text
GET    /api/admin/overview
GET    /api/admin/images
DELETE /api/admin/images/:id
GET    /api/admin/quota-requests
PATCH  /api/admin/quota-requests/:id
```

这些管理员会话也可读取 `/i/:id` 私密原图进行审核。个人 API 令牌不获得此权限。

## 依赖许可与验证

更新 Android 依赖后重新生成并提交离线许可声明：

```sh
cd android
./gradlew :app:exportLibraryDefinitions
cd ..
python3 scripts/android-notices.py
```

App 在“我的 → 开源许可”提供完整声明。CI 会重新生成依赖清单并检查声明是否过期。后端行为测试位于 `tests/mobile.test.ts`，客户端测试覆盖会话续期、退出认证、跨来源凭据隔离、地址验证、连续加载、去重、失败重试、取消后的旧响应、加载深度保留、导航返回、公告状态隔离与资料兼容。

真机验收建议：Android 13+ 检查图库滚动时的实时玻璃效果及深色模式；Android 8–12 检查降级样式；测试注册验证、失效会话、私密图片、分享接收、多图上传、管理员删除与审批。没有连接真机时，编译和单元测试不代表已经验证玻璃渲染或设备帧率。
