package io.github.qiuyuxc.yingyu

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Text

@Composable fun AppSettingsScreen(vm: MainViewModel) {
    val context = LocalContext.current
    Page(vm, "应用设置", actions = { IconAction("refresh", "更新站点信息") { vm.refresh() } }) {
        GlassCard(Modifier.fillMaxWidth(), padding = PaddingValues(8.dp), spacing = 0.dp) {
            val palette = when (vm.palette) { "mono" -> "系统黑白"; "blue" -> "雾蓝"; else -> "森林绿" }
            val theme = when (vm.theme) { "light" -> "浅色"; "dark" -> "深色"; else -> "跟随系统" }
            SettingsRow("appearance", "外观", "$palette · $theme") { vm.navigate("appearance") }
            Divider(Modifier.padding(horizontal = 8.dp))
            ToggleRow("公告弹窗", "提醒站点最新发布的公告", vm.noticeLedger?.popupsEnabled != false) { vm.popupPreference(it) }
            Divider(Modifier.padding(horizontal = 8.dp))
            ToggleRow("减少动态效果", "简化页面与弹窗的过渡", vm.reduceMotion) { vm.motion(it) }
        }
        GlassCard(Modifier.fillMaxWidth(), padding = PaddingValues(8.dp), spacing = 0.dp) {
            SettingsRow("help", "使用帮助", "上传、相册和分享指南") { vm.navigate("help") }
            Divider(Modifier.padding(horizontal = 8.dp))
            SettingsRow("globe", "当前站点", LocalSession.current?.baseUrl) {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(vm.session.value?.baseUrl)))
            }
            Divider(Modifier.padding(horizontal = 8.dp))
            SettingsRow("notice", "开源许可") { vm.navigate("licenses") }
        }
        vm.syncError?.let { error -> GlassCard(Modifier.fillMaxWidth()) {
            Hint(error)
            Action("重新连接", compact = true) { vm.syncSite(force = true) }
        } }
        Hint("映屿 Android " + BuildConfig.VERSION_NAME)
    }
}

@Composable fun AppearanceScreen(vm: MainViewModel) {
    Page(vm, "外观") {
        GlassCard(Modifier.fillMaxWidth()) {
            Text("显示模式", fontSize = AppType.section)
            Choices(listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色"), vm.theme, { vm.appearance(newTheme = it) })
            Divider()
            Text("配色", fontSize = AppType.section)
            Choices(listOf("mono" to "系统黑白", "forest" to "森林绿", "blue" to "雾蓝"), vm.palette, { vm.appearance(newPalette = it) })
            Divider()
            Text("底部导航", fontSize = AppType.section)
            Choices(listOf("on" to "通透玻璃", "off" to "减少透明"), if (vm.glass) "on" else "off", { vm.appearance(effects = it == "on") })
        }
    }
}

@Composable fun HelpScreen(vm: MainViewModel) {
    val guide = listOf(
        "上传图片" to "在底部“上传”中选择系统相册里的图片，设置相册和可见性后开始上传。失败的任务可以单独重试。",
        "整理相册" to "在“相册”中创建或重命名分类，点击相册连续浏览图片。长按图片可移动到相册，也可选择多张一起操作。",
        "分享链接" to "打开图片详情选择直链、Markdown、HTML 或 BBCode，然后复制或调用系统分享。双指缩放和双击可查看图片细节。",
        "公开与私密" to "公开图片可供持有链接的人访问。私密图片只对本人和管理员开放，外链访问仍需要登录。",
        "账户与空间" to "在“我的”中打开账户设置，编辑昵称和头像、更换邮箱或密码。空间不足时可以免费申请扩容。"
    )
    Page(vm, "使用帮助") {
        guide.forEach { (title, body) -> GlassCard(Modifier.fillMaxWidth()) {
            Text(title, fontSize = AppType.section)
            Hint(body)
        } }
        Action("去上传图片", primary = true) { vm.selectTab(2) }
    }
}

@Composable fun LicensesScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val text = remember { context.assets.open("third-party-notices.txt").bufferedReader().use { it.readText() } }
    Page(vm, "开源许可") { Text(text, fontSize = AppType.body, lineHeight = AppType.bodyLine) }
}
