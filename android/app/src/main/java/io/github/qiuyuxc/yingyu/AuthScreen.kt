package io.github.qiuyuxc.yingyu

import androidx.core.net.toUri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import top.yukonga.miuix.kmp.basic.Text

@Composable fun AuthScreen(vm: MainViewModel) {
    var server by rememberSaveable { mutableStateOf(vm.lastServer) }
    var editingServer by rememberSaveable { mutableStateOf(vm.lastServer.isBlank()) }
    var email by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var resetLink by remember { mutableStateOf("") }
    var mode by rememberSaveable { mutableStateOf("login") }
    var formError by remember { mutableStateOf<String?>(null) }
    val canSubmit = !vm.working && server.isNotBlank() && when (mode) {
        "register" -> email.isNotBlank() && name.isNotBlank() && password.length >= 10
        "verify-email" -> email.isNotBlank() && code.length == 6
        "forgot-password" -> email.isNotBlank()
        "reset-password" -> resetLink.isNotBlank() && password.length >= 10
        else -> email.isNotBlank() && password.isNotEmpty()
    }
    val submit: () -> Unit = {
        if (canSubmit) {
            formError = null
            vm.work {
                try {
                    val base = canonicalServer(server, allowLocalHttp = BuildConfig.DEBUG)
                    val capabilities = vm.api.publicRequest(base, "/api/mobile/v1/capabilities")
                    require(capabilities.optInt("apiVersion") == 1) { "请先更新站点后端以支持 Android App" }
                    vm.rememberServer(base)
                    val body = when (mode) {
                        "register" -> jsonOf("email" to email.trim(), "name" to name.trim(), "password" to password)
                        "verify-email" -> jsonOf("email" to email.trim(), "code" to code)
                        "forgot-password" -> jsonOf("email" to email.trim())
                        "reset-password" -> {
                            val uri = resetLink.trim().toUri()
                            val token = ("https://local/?" + uri.fragment.orEmpty()).toUri().getQueryParameter("token")
                                ?: uri.getQueryParameter("token") ?: resetLink.trim()
                            jsonOf("token" to token, "password" to password)
                        }
                        else -> jsonOf("email" to email.trim(), "password" to password)
                    }
                    try {
                        val result = vm.api.signIn(base, mode, body)
                        when {
                            result.optBoolean("verificationRequired") -> {
                                mode = "verify-email"; password = ""; vm.message = "验证码已发送，请检查邮箱"
                            }
                            mode == "forgot-password" -> { mode = "reset-password"; vm.message = result.optString("message") }
                            mode == "reset-password" -> { mode = "login"; password = ""; vm.message = "密码已更新，请重新登录" }
                        }
                    } catch (e: ApiException) {
                        if (e.payload.optBoolean("verificationRequired")) {
                            mode = "verify-email"; password = ""; formError = "请先验证邮箱，可重新发送验证码"
                        } else throw e
                    }
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { formError = e.message ?: "连接失败，请重试" }
            }
        }
    }
    val keyboardVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val showPreview = !keyboardVisible && maxHeight >= 620.dp
        // Keep the brand, preview and form together. Extra fields and the
        // keyboard scroll naturally instead of creating empty screen sections.
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = maxHeight)
            .padding(horizontal = AppSpacing.pagePadding)
            .padding(top = 16.dp, bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically)) {
            Column(Modifier.widthIn(max = 420.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(LocalColors.current.accent.copy(alpha = .10f)), contentAlignment = Alignment.Center) {
                        Glyph("images", Modifier.size(26.dp))
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("映屿", fontSize = AppType.heading, lineHeight = 28.sp)
                        Hint("轻盈存放，自在分享。")
                    }
                }
                if (showPreview) AuthPreview()
                GlassCard(Modifier.fillMaxWidth(), padding = PaddingValues(16.dp), spacing = 12.dp) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(when (mode) {
                            "register" -> "创建你的空间"; "verify-email" -> "验证邮箱"; "forgot-password" -> "找回密码"
                            "reset-password" -> "设置新密码"; else -> "欢迎回到映屿"
                        }, fontSize = AppType.title, lineHeight = 22.sp)
                        Hint(when (mode) {
                            "register" -> "使用邮箱创建账号，开始收藏你的图片。"
                            "verify-email" -> "输入邮件中的 6 位验证码。"
                            "forgot-password" -> "我们会向你的邮箱发送重置链接。"
                            "reset-password" -> "粘贴邮件中的链接，并设置新密码。"
                            else -> "登录后，继续上传、整理和分享。"
                        })
                    }
                    if (editingServer) {
                        Field("站点地址", server, { server = it }, placeholder = "https://images.example.com", keyboardType = KeyboardType.Uri, enabled = !vm.working)
                    } else {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Glyph("globe", Modifier.size(16.dp), LocalColors.current.muted)
                            Column(Modifier.weight(1f)) {
                                Text("当前站点", fontSize = AppType.small, lineHeight = 13.sp, color = LocalColors.current.muted)
                                Text(server.removePrefix("https://").removePrefix("http://"), fontSize = AppType.body,
                                    lineHeight = AppType.bodyLine, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Action("更换", compact = true, enabled = !vm.working) { editingServer = true }
                        }
                    }
                    if (mode != "reset-password") Field("邮箱", email, { email = it }, placeholder = "name@example.com", keyboardType = KeyboardType.Email, enabled = !vm.working)
                    if (mode == "register") Field("昵称", name, { name = it.take(40) }, placeholder = "怎么称呼你", enabled = !vm.working)
                    if (mode in listOf("login", "register", "reset-password")) {
                        Field(if (mode == "reset-password") "新密码" else "密码", password, { password = it }, password = true,
                            placeholder = if (mode == "login") "输入密码" else "至少 10 个字符", enabled = !vm.working,
                            onSubmit = if (mode == "reset-password") null else submit)
                    }
                    if (mode == "verify-email") Field("邮箱验证码", code, { code = it.filter(Char::isDigit).take(6) },
                        keyboardType = KeyboardType.Number, enabled = !vm.working, onSubmit = submit)
                    if (mode == "reset-password") Field("重置链接", resetLink, { resetLink = it }, keyboardType = KeyboardType.Uri,
                        enabled = !vm.working, onSubmit = submit)
                    formError?.let { Text(it, fontSize = AppType.caption, lineHeight = AppType.captionLine, color = Color(0xFFCA6262)) }
                    Action(if (vm.working) "正在连接…" else when (mode) {
                        "register" -> "创建账号"; "verify-email" -> "验证并登录"; "forgot-password" -> "发送重置邮件"
                        "reset-password" -> "保存新密码"; else -> "登录我的空间"
                    }, Modifier.fillMaxWidth(), enabled = canSubmit, primary = true, onClick = submit)
                    if (mode == "verify-email") Action("重新发送验证码", enabled = !vm.working) { vm.work {
                        vm.api.publicRequest(canonicalServer(server, allowLocalHttp = BuildConfig.DEBUG), "/api/mobile/v1/auth/resend-verification", jsonOf("email" to email.trim()))
                        vm.message = "验证码已申请发送，请稍后检查邮箱"
                    } }
                    Divider()
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Action(if (mode == "login") "创建账号" else "返回登录", compact = true, enabled = !vm.working) {
                            mode = if (mode == "login") "register" else "login"; password = ""; formError = null
                        }
                        if (mode == "login") Action("忘记密码", compact = true, enabled = !vm.working) {
                            mode = "forgot-password"; password = ""; formError = null
                        }
                    }
                }
                Text("图片保存在你选择的站点", modifier = Modifier.fillMaxWidth(), fontSize = AppType.small,
                    lineHeight = 13.sp, color = LocalColors.current.muted, textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable private fun AuthPreview() {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(R.drawable.auth_forest to "上传图片", R.drawable.auth_lake to "整理相册", R.drawable.auth_mountain to "分享灵感").forEach { (photo, label) ->
            Box(Modifier.weight(1f).height(96.dp).clip(RoundedCornerShape(12.dp))) {
                Image(painterResource(photo), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .55f)))))
                Text(label, modifier = Modifier.align(Alignment.BottomStart).padding(9.dp), fontSize = AppType.caption,
                    lineHeight = AppType.captionLine, color = Color.White)
            }
        }
    }
}
