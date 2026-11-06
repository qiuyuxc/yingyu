package io.github.qiuyuxc.yingyu

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import top.yukonga.miuix.kmp.basic.Switch
import top.yukonga.miuix.kmp.basic.Text

@Composable fun MineScreen(vm: MainViewModel, user: User) {
    Page(vm, "我的") {
        GlassCard(Modifier.fillMaxWidth(), onClick = { vm.navigate("account") }) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ProfileAvatar(vm, user, Modifier.size(48.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(user.name, fontSize = AppType.title, lineHeight = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Hint(user.email)
                    Text("个人资料与账户安全", fontSize = AppType.small, lineHeight = 13.sp, color = LocalColors.current.accent)
                }
                Glyph("next", Modifier.size(15.dp), LocalColors.current.muted)
            }
        }
        GlassCard(Modifier.fillMaxWidth(), onClick = { vm.navigate("quota") }) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Glyph("space", Modifier.size(23.dp))
                Column(Modifier.weight(1f)) {
                    Text("空间与配额", fontSize = AppType.section, lineHeight = 19.sp)
                    Hint("${bytes(user.used)} / ${bytes(user.quota)}")
                }
                Text("${user.imageCount} 张图片", fontSize = AppType.caption, lineHeight = AppType.captionLine, color = LocalColors.current.muted)
                Glyph("next", Modifier.size(15.dp), LocalColors.current.muted)
            }
            AppProgress(if (user.quota > 0) (user.used + user.reserved).toFloat() / user.quota else 1f)
            Hint("可用 ${bytes(user.quota - user.used - user.reserved)} · 免费申请扩容")
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            GlassCard(Modifier.weight(1f), onClick = { vm.navigate("announcements") }) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Glyph("notice", Modifier.size(21.dp))
                    if (vm.hasUnreadNotices) Text("新公告", fontSize = AppType.small, color = LocalColors.current.accent)
                }
                Text("公告中心", fontSize = AppType.section, lineHeight = 19.sp)
                Hint("查看站点通知")
            }
            GlassCard(Modifier.weight(1f), onClick = { vm.navigate("settings") }) {
                Glyph("settings", Modifier.size(21.dp))
                Text("应用设置", fontSize = AppType.section, lineHeight = 19.sp)
                Hint("外观、提醒与帮助")
            }
        }
        if (user.isAdmin) GlassCard(Modifier.fillMaxWidth(), padding = PaddingValues(8.dp), spacing = 0.dp) {
            SettingsRow("space", "管理工作台", "图片管理与扩容审核") { vm.navigate("admin") }
        }
    }
}

@Composable fun ProfileAvatar(vm: MainViewModel, user: User?, modifier: Modifier = Modifier) {
    Box(modifier.clip(RoundedCornerShape(14.dp)).background(LocalColors.current.accent.copy(alpha = .09f)), contentAlignment = Alignment.Center) {
        if (user?.avatar != null) Photo(vm, user.avatar, "当前头像", Modifier.fillMaxSize())
        else Glyph("user", Modifier.size(28.dp))
    }
}

@Composable fun AccountScreen(vm: MainViewModel) {
    val user = LocalSession.current?.user
    var name by rememberSaveable(user?.id) { mutableStateOf(user?.name.orEmpty()) }
    var avatarOptions by rememberSaveable { mutableStateOf(false) }
    var advanced by rememberSaveable { mutableStateOf(false) }
    var signOut by remember { mutableStateOf(false) }
    var closingLibrary by remember { mutableStateOf(false) }
    var removingAvatar by remember { mutableStateOf<JSONObject?>(null) }
    val avatars = resource(vm, "/api/account/avatars")
    val duration = if (LocalMotionEnabled.current) 180 else 0
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) vm.work("头像已更新") { vm.uploadAvatar(uri) }
    }
    val pick: () -> Unit = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
    Page(vm, "账户设置") {
        GlassCard(Modifier.fillMaxWidth()) {
            Text("个人资料", fontSize = AppType.section, lineHeight = 19.sp)
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(enabled = !vm.working, onClick = pick)
                .semantics { contentDescription = "更换头像" }.padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ProfileAvatar(vm, user, Modifier.size(56.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("点击更换头像", fontSize = AppType.body, lineHeight = AppType.bodyLine)
                    Hint("当前头像免费 · 最大 5 MB")
                }
                Glyph("edit", Modifier.size(17.dp), LocalColors.current.muted)
            }
            Field("昵称", name, { name = it.take(40) }, enabled = !vm.working)
            Action("保存昵称", primary = true, enabled = !vm.working && name.isNotBlank() && name.trim() != user?.name) {
                vm.work("昵称已更新") { vm.api.request("/api/account/profile", "PATCH", jsonOf("name" to name.trim())) }
            }
            Divider()
            ExpandRow("头像历史", if ((user?.avatarHistoryCount ?: 0) > 0) "${user?.avatarHistoryCount} 个历史头像" else "按需保留旧头像", avatarOptions) { avatarOptions = !avatarOptions }
            AnimatedVisibility(avatarOptions, enter = expandVertically(tween(duration)) + fadeIn(tween(duration)), exit = shrinkVertically(tween(duration)) + fadeOut(tween(duration))) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    ResourceState(avatars, vm) { data ->
                        val enabled = data.optBoolean("enabled")
                        ToggleRow("保留历史头像", "最多 10 个，占用存储空间", enabled, !vm.working) { value ->
                            if (!value && data.getJSONArray("history").length() > 0) closingLibrary = true
                            else vm.work { vm.api.request("/api/account/avatars/library", "PATCH", jsonOf("enabled" to value)) }
                        }
                        if (data.getJSONArray("history").length() > 0) SettingsRow("user", "查看历史头像", "换回以前的头像或删除历史记录") { vm.navigate("avatar-history") }
                        data.nullableString("expiresAt")?.let { Hint("旧头像将于 ${it.take(10)} 清理，重新开启保留可取消清理。") }
                        if (data.optInt("pendingDeletes") > 0) Action("重试清理", compact = true, enabled = !vm.working) {
                            vm.work { vm.api.request("/api/account/avatars/cleanup", "POST", jsonOf()) }
                        }
                        data.optJSONObject("current")?.let { entry -> Action("移除当前头像", compact = true, enabled = !vm.working) { removingAvatar = entry } }
                    }
                }
            }
        }
        GlassCard(Modifier.fillMaxWidth(), padding = PaddingValues(8.dp), spacing = 0.dp) {
            Text("账户安全", modifier = Modifier.padding(6.dp), fontSize = AppType.section, lineHeight = 19.sp)
            SettingsRow("mail", "登录邮箱", user?.email) { vm.navigate("email") }
            Divider(Modifier.padding(horizontal = 8.dp))
            SettingsRow("lock", "修改密码", "验证当前密码后更新") { vm.navigate("password") }
        }
        GlassCard(Modifier.fillMaxWidth()) {
            ExpandRow("高级功能", "供脚本与自动化使用", advanced) { advanced = !advanced }
            AnimatedVisibility(advanced, enter = expandVertically(tween(duration)) + fadeIn(tween(duration)), exit = shrinkVertically(tween(duration)) + fadeOut(tween(duration))) {
                SettingsRow("key", "API 访问令牌", "创建或撤销本账户的访问令牌") { vm.navigate("tokens") }
            }
        }
        Hint("当前站点：" + LocalSession.current?.baseUrl.orEmpty())
        Action("退出登录", enabled = !vm.working) { signOut = true }
    }
    if (closingLibrary) ConfirmDialog(vm, "关闭头像历史保留？", "已有历史头像保留 7 天后清理，期间继续占用空间。当前头像保留。", { closingLibrary = false }) {
        vm.api.request("/api/account/avatars/library", "PATCH", jsonOf("enabled" to false))
    }
    removingAvatar?.let { entry -> ConfirmDialog(vm, "移除当前头像？", "移除后将显示默认头像。", { removingAvatar = null }) {
        vm.api.request("/api/account/avatars/" + entry.getString("id"), "DELETE")
    } }
    if (signOut) FormDialog("退出登录？", { if (!vm.working) signOut = false }, footer = {
        Action("退出登录", Modifier.weight(1f), primary = true, enabled = !vm.working) { signOut = false; vm.signOut() }
    }) {
        Hint(if (vm.uploading) "正在上传的任务将被取消，已上传的图片保留。" else "将退出本机账户，之后可登录其他账户或站点。")
    }
}

@Composable fun PasswordScreen(vm: MainViewModel) {
    var current by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    Page(vm, "修改密码") {
        GlassCard(Modifier.fillMaxWidth()) {
            Field("当前密码", current, { current = it }, password = true, enabled = !vm.working)
            Field("新密码", password, { password = it }, password = true, placeholder = "至少 10 个字符", enabled = !vm.working)
            Field("确认新密码", confirmation, { confirmation = it }, password = true, enabled = !vm.working)
            if (confirmation.isNotEmpty() && confirmation != password) Text("两次输入的密码不一致", fontSize = AppType.caption, color = androidx.compose.ui.graphics.Color(0xFFCA6262))
            Hint("更新后撤销其他登录会话和已有 API 令牌，本机保持登录。")
            Action("保存密码", Modifier.fillMaxWidth(), primary = true,
                enabled = !vm.working && current.isNotEmpty() && password.length >= 10 && password == confirmation) {
                vm.work("密码已更新") {
                    vm.api.request("/api/account/password", "PATCH", jsonOf("currentPassword" to current, "password" to password))
                    current = ""; password = ""; confirmation = ""; vm.goBack()
                }
            }
        }
    }
}

@Composable fun EmailScreen(vm: MainViewModel) {
    val data = resource(vm, "/api/account/email-change")
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var checkedExpiry by remember { mutableStateOf<String?>(null) }
    val now = rememberNow()
    val pending = data.data?.optJSONObject("pending")
    val expired = pending != null && remainingSeconds(pending.optString("expiresAt"), now) == 0L
    LaunchedEffect(pending?.optString("requestId"), expired) {
        val id = pending?.optString("requestId")
        if (expired && id != null && checkedExpiry != id) { checkedExpiry = id; vm.revision++ }
    }
    Page(vm, "登录邮箱", LocalSession.current?.user?.email) {
        ResourceState(data, vm) { result ->
            GlassCard(Modifier.fillMaxWidth()) {
                if (!result.optBoolean("enabled")) {
                    Text("暂时不能更换邮箱", fontSize = AppType.section, lineHeight = 19.sp)
                    Hint("当前站点未启用邮件验证，请联系管理员。")
                } else if (pending == null) {
                    Field("新邮箱", email, { email = it }, keyboardType = KeyboardType.Email, placeholder = "name@example.com", enabled = !vm.working)
                    Field("当前密码", password, { password = it }, password = true, enabled = !vm.working)
                    Action("发送验证码", Modifier.fillMaxWidth(), primary = true, enabled = !vm.working && email.isNotBlank() && password.isNotEmpty()) {
                        vm.work("请检查新邮箱中的验证码") {
                            vm.api.request("/api/account/email-change", "POST", jsonOf("email" to email.trim(), "currentPassword" to password)); password = ""
                        }
                    }
                } else {
                    Text("验证 " + pending.getString("email"), fontSize = AppType.section, lineHeight = 19.sp)
                    Hint("验证成功前原邮箱继续有效。更换后撤销其他会话和已有 API 令牌。")
                    if (!pending.optBoolean("delivered")) Hint("验证码尚未成功发送，请重新发送。")
                    Field("6 位验证码", code, { code = it.filter(Char::isDigit).take(6) }, keyboardType = KeyboardType.Number, enabled = !vm.working)
                    Hint("剩余有效时间 ${(remainingSeconds(pending.optString("expiresAt"), now) + 59) / 60} 分钟 · 剩余 ${pending.optInt("remainingAttempts")} 次尝试")
                    Action("确认更换", Modifier.fillMaxWidth(), primary = true,
                        enabled = !vm.working && code.length == 6 && pending.optBoolean("delivered") && pending.optInt("remainingAttempts") > 0 && !expired) {
                        vm.work("登录邮箱已更新") {
                            vm.api.request("/api/account/email-change/confirm", "POST", jsonOf("requestId" to pending.getString("requestId"), "code" to code)); code = ""
                        }
                    }
                    val resend = remainingSeconds(pending.optString("resendAt"), now)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Action(if (resend > 0) "${resend}秒后重发" else "重新发送", compact = true, enabled = !vm.working && resend == 0L) {
                            vm.work("验证码已申请发送") { vm.api.request("/api/account/email-change/resend", "POST", jsonOf("requestId" to pending.getString("requestId"))); code = "" }
                        }
                        Action("取消更换", compact = true, enabled = !vm.working) { vm.work { vm.api.request("/api/account/email-change", "DELETE"); code = "" } }
                    }
                }
            }
        }
    }
}

@Composable fun TokensScreen(vm: MainViewModel) {
    val data = resource(vm, "/api/account/tokens")
    var name by rememberSaveable { mutableStateOf("") }
    var token by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<JSONObject?>(null) }
    val context = LocalContext.current
    Page(vm, "API 访问令牌", "用于脚本上传和访问本人的资源") {
        GlassCard(Modifier.fillMaxWidth()) {
            Field("令牌名称", name, { name = it.take(40) }, placeholder = "例如：博客上传", enabled = !vm.working)
            Action("创建令牌", primary = true, enabled = !vm.working && name.isNotBlank()) { vm.work {
                token = vm.api.request("/api/account/tokens", "POST", jsonOf("name" to name.trim())).getString("token"); name = ""
            } }
        }
        ResourceState(data, vm) { result ->
            val entries = result.getJSONArray("tokens").mapObjects { it }
            if (entries.isEmpty()) Hint("还没有访问令牌")
            entries.forEach { entry -> GlassCard(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Glyph("key", Modifier.size(21.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(entry.getString("name"), fontSize = AppType.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Hint(entry.getString("prefix") + "…")
                        Hint(entry.optString("createdAt").take(10) + " 创建")
                    }
                    IconAction("trash", "撤销令牌：" + entry.getString("name"), enabled = !vm.working) { deleting = entry }
                }
            } }
        }
    }
    token?.let { value -> FormDialog("令牌已创建", { token = null }, footer = {
        Action("复制令牌", Modifier.weight(1f), primary = true) { copy(context, value, sensitive = true); vm.message = "令牌已复制" }
    }) { Hint("完整令牌仅展示这一次，请妥善保存。"); SelectionContainer { Text(value, fontSize = AppType.body, lineHeight = AppType.bodyLine) } } }
    deleting?.let { entry -> ConfirmDialog(vm, "撤销令牌？", "使用此令牌的脚本将无法继续访问。", { deleting = null }) {
        vm.api.request("/api/account/tokens/" + entry.getString("id"), "DELETE")
    } }
}

@Composable fun AvatarsScreen(vm: MainViewModel) {
    val data = resource(vm, "/api/account/avatars")
    var deleting by remember { mutableStateOf<JSONObject?>(null) }
    Page(vm, "历史头像") {
        ResourceState(data, vm) { result ->
            val history = result.getJSONArray("history").mapObjects { it }
            result.nullableString("expiresAt")?.let {
                GlassCard(Modifier.fillMaxWidth()) {
                    Hint("历史头像将于 ${it.take(10)} 清理。")
                    Action("继续保留", compact = true, primary = true, enabled = !vm.working) {
                        vm.work("已继续保留") { vm.api.request("/api/account/avatars/library", "PATCH", jsonOf("enabled" to true)) }
                    }
                }
            }
            if (history.isEmpty()) GlassCard(Modifier.fillMaxWidth()) { Hint("暂无历史头像。可在账户资料中开启保留旧头像。") }
            history.forEach { entry -> GlassCard(Modifier.fillMaxWidth()) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Photo(vm, entry.getString("url"), "历史头像", Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)))
                    Column(Modifier.weight(1f)) {
                        Text(entry.optString("createdAt").take(10), fontSize = AppType.body, lineHeight = AppType.bodyLine)
                        Hint(bytes(entry.getLong("size")))
                    }
                    IconAction("trash", "删除历史头像", enabled = !vm.working) { deleting = entry }
                }
                Action("设为头像", compact = true, enabled = !vm.working) {
                    vm.work("头像已切换") { vm.api.request("/api/account/avatars/" + entry.getString("id") + "/select", "POST", jsonOf()) }
                }
            } }
            if (result.optInt("pendingDeletes") > 0) Action("重试清理", compact = true, enabled = !vm.working) {
                vm.work { vm.api.request("/api/account/avatars/cleanup", "POST", jsonOf()) }
            }
        }
    }
    deleting?.let { entry -> ConfirmDialog(vm, "删除历史头像？", "删除成功后归还该头像占用的空间。", { deleting = null }) {
        vm.api.request("/api/account/avatars/" + entry.getString("id"), "DELETE")
    } }
}
