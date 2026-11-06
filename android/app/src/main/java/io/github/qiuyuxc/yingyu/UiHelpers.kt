package io.github.qiuyuxc.yingyu

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.PersistableBundle
import android.view.View
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.IconButton
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextField
import top.yukonga.miuix.kmp.theme.MiuixTheme
import java.net.URLEncoder
import java.time.Instant
import top.yukonga.miuix.kmp.basic.Switch

data class Resource(val data: JSONObject? = null, val error: String? = null, val loading: Boolean = true)
@Composable fun rememberNow(interval: Long = 1000): Long {
    val now by produceState(System.currentTimeMillis(), interval) { while (true) { delay(interval); value = System.currentTimeMillis() } }
    return now
}
fun remainingSeconds(time: String?, now: Long): Long = runCatching { ((Instant.parse(time).toEpochMilli() - now + 999) / 1000).coerceAtLeast(0) }.getOrDefault(0)
@Composable fun ExpandRow(title: String, caption: String?, expanded: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).clickable(onClick = onClick).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, fontSize = AppType.body, lineHeight = AppType.bodyLine)
            if (caption != null) Text(caption, fontSize = AppType.small, lineHeight = 13.sp, color = LocalColors.current.muted)
        }
        Glyph(if (expanded) "down" else "next", Modifier.size(14.dp), LocalColors.current.muted)
    }
}
@Composable fun ToggleRow(title: String, caption: String?, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, fontSize = AppType.body, lineHeight = AppType.bodyLine)
            if (caption != null) Text(caption, fontSize = AppType.small, lineHeight = 13.sp, color = LocalColors.current.muted)
        }
        Switch(checked, onChange, modifier = Modifier.semantics { contentDescription = title }, enabled = enabled)
    }
}
@Composable fun resource(vm: MainViewModel, path: String): Resource {
    val result by produceState(Resource(), path, vm.revision) {
        value = Resource()
        value = try { Resource(data = vm.api.request(path), loading = false) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { Resource(error = e.message ?: "加载失败", loading = false) }
    }
    return result
}
@Composable fun ResourceState(value: Resource, vm: MainViewModel, content: @Composable (JSONObject) -> Unit) {
    when {
        value.loading -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(modifier = Modifier.size(24.dp)) }
        value.error != null -> GlassCard(Modifier.fillMaxWidth()) { Text(value.error); Action("重新加载") { vm.revision++ } }
        value.data != null -> content(value.data)
    }
}
@Composable fun contentBottomPadding(vm: MainViewModel) = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() +
    AppSpacing.pageGap + if (LocalScreenRoute.current.isEmpty() && LocalSession.current != null && WindowInsets.ime.getBottom(LocalDensity.current) == 0)
        AppSpacing.navigationHeight + AppSpacing.navigationPadding * 2 else 0.dp

@Composable fun Page(
    vm: MainViewModel,
    title: String,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = AppSpacing.contentWidth).fillMaxSize().verticalScroll(rememberScrollState())
            .padding(horizontal = AppSpacing.pagePadding).padding(top = 12.dp, bottom = contentBottomPadding(vm)),
            verticalArrangement = Arrangement.spacedBy(AppSpacing.pageGap)) {
            PageHeader(title, subtitle, onBack = if (LocalScreenRoute.current.isNotEmpty()) ({ vm.goBack() }) else null, actions = actions)
            content()
        }
    }
}
@Composable fun IconAction(
    icon: String,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    color: Color = LocalColors.current.muted,
    onClick: () -> Unit,
) {
    IconButton(onClick = onClick, modifier = modifier.semantics { contentDescription = label }, enabled = enabled,
        minHeight = 32.dp, minWidth = 32.dp, cornerRadius = AppSpacing.controlRadius) {
        Glyph(icon, Modifier.size(17.dp), color)
    }
}

@Composable fun Divider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(LocalColors.current.muted.copy(alpha = .10f)))
}

@Composable fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    password: Boolean = false,
    multiline: Boolean = false,
    number: Boolean = false,
    showLabel: Boolean = true,
    placeholder: String? = null,
    icon: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    enabled: Boolean = true,
    onSubmit: (() -> Unit)? = null,
) {
    var revealed by remember { mutableStateOf(false) }
    // Miuix's built-in floating label is fixed at 17sp. A separate compact label
    // follows the web forms and keeps filled/empty inputs at the same height.
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (showLabel) Text(label, fontSize = AppType.caption, lineHeight = 14.sp, color = LocalColors.current.muted)
        Box(contentAlignment = Alignment.CenterStart) {
            TextField(value, onChange, modifier = Modifier.fillMaxWidth().semantics { contentDescription = label }, label = "", singleLine = !multiline,
                textStyle = MiuixTheme.textStyles.main.copy(lineHeight = 16.sp, color = LocalColors.current.text),
                insideMargin = DpSize(11.dp, 10.dp), cornerRadius = AppSpacing.controlRadius,
                minLines = if (multiline) 3 else 1, enabled = enabled,
                leadingIcon = icon?.let { { Box(Modifier.width(36.dp), contentAlignment = Alignment.Center) {
                    Glyph(it, Modifier.size(16.dp), LocalColors.current.muted)
                } } },
                trailingIcon = if (password) ({ IconAction(if (revealed) "eye-off" else "eye", if (revealed) "隐藏密码" else "显示密码") { revealed = !revealed } }) else null,
                visualTransformation = if (password && !revealed) PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else if (number) KeyboardType.Decimal else keyboardType,
                    imeAction = if (multiline) ImeAction.Default else if (onSubmit != null) ImeAction.Done else ImeAction.Next),
                keyboardActions = if (onSubmit != null) KeyboardActions(onDone = { onSubmit() }) else KeyboardActions.Default)
            if (value.isEmpty() && placeholder != null) Text(placeholder, modifier = Modifier.padding(start = if (icon == null) 11.dp else 36.dp, end = if (password) 44.dp else 11.dp),
                fontSize = AppType.body, lineHeight = 16.sp, color = LocalColors.current.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
@Composable fun Choices(values: List<Pair<String, String>>, selected: String, onChange: (String) -> Unit, enabled: Boolean = true) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        values.forEach { (key, label) -> Action(label, primary = selected == key, enabled = enabled, compact = true) { onChange(key) } }
    }
}
private class MenuPosition(private val margin: Int) : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
        val preferredX = if (layoutDirection == LayoutDirection.Ltr) anchorBounds.left else anchorBounds.right - popupContentSize.width
        val maxX = (windowSize.width - popupContentSize.width - margin).coerceAtLeast(margin)
        val maxY = (windowSize.height - popupContentSize.height - margin).coerceAtLeast(margin)
        val below = anchorBounds.bottom + margin
        val y = if (below <= maxY) below else anchorBounds.top - popupContentSize.height - margin
        return IntOffset(preferredX.coerceIn(margin, maxX), y.coerceIn(margin, maxY))
    }
}

private fun removeNativePopupShadow(view: View) {
    // Dialog/Popup roots reserve elevation outside their rectangular window bounds.
    // Our surfaces use a rounded border, so no native shadow needs that extra region.
    var current: View? = view
    while (current != null) {
        if (current.elevation != 0f) current.elevation = 0f
        if (current.translationZ != 0f) current.translationZ = 0f
        if (current.outlineProvider != null) current.outlineProvider = null
        current = current.parent as? View
    }
}

@Composable fun MenuPopup(dismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val margin = with(LocalDensity.current) { 8.dp.roundToPx() }
    val position = remember(margin) { MenuPosition(margin) }
    val colors = LocalColors.current
    val shape = RoundedCornerShape(14.dp)
    var entered by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { entered = true }
    val opacity by animateFloatAsState(if (entered) 1f else 0f, tween(if (LocalMotionEnabled.current) 120 else 0), label = "menu opacity")
    Popup(popupPositionProvider = position, onDismissRequest = dismiss, properties = PopupProperties(focusable = true)) {
        val popupView = LocalView.current
        SideEffect { removeNativePopupShadow(popupView) }
        Column(Modifier.widthIn(min = 180.dp, max = 260.dp).heightIn(max = 300.dp)
            .graphicsLayer(alpha = opacity)
            .clip(shape).background(colors.panel).border(1.dp, colors.muted.copy(alpha = .10f), shape)
            .verticalScroll(rememberScrollState()).padding(5.dp), content = content)
    }
}

@Composable fun MenuOption(
    label: String,
    icon: String? = null,
    checked: Boolean = false,
    danger: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val color = if (danger) Color(0xFFCA6262) else LocalColors.current.text
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .semantics { selected = checked }.padding(horizontal = 10.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) Glyph(icon, Modifier.size(16.dp), color)
        Text(label, modifier = Modifier.weight(1f), fontSize = AppType.body, lineHeight = AppType.bodyLine, color = color,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (checked) Glyph("check", Modifier.size(15.dp))
    }
}

@Composable fun SelectionField(
    label: String,
    values: List<Pair<String, String>>,
    selected: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    var expanded by remember { mutableStateOf(false) }
    val colors = LocalColors.current
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, fontSize = AppType.caption, lineHeight = 14.sp, color = colors.muted)
        Box {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(AppSpacing.controlRadius))
                .background(colors.accent.copy(alpha = .06f)).border(1.dp, colors.muted.copy(alpha = .12f), RoundedCornerShape(AppSpacing.controlRadius))
                .clickable(enabled = enabled, role = Role.Button) { focus.clearFocus(); keyboard?.hide(); expanded = true }
                .padding(horizontal = 11.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(values.firstOrNull { it.first == selected }?.second ?: "请选择", modifier = Modifier.weight(1f),
                    fontSize = AppType.body, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Glyph("down", Modifier.size(14.dp), colors.muted)
            }
            if (expanded) MenuPopup({ expanded = false }) {
                values.forEach { (key, text) -> MenuOption(text, checked = key == selected) { expanded = false; onChange(key) } }
            }
        }
    }
}

@Composable fun SettingsRow(icon: String, title: String, description: String? = null, onClick: () -> Unit) {
    val colors = LocalColors.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(role = Role.Button, onClick = onClick)
        .padding(horizontal = 6.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(28.dp).clip(RoundedCornerShape(9.dp)).background(colors.accent.copy(alpha = .09f)), contentAlignment = Alignment.Center) {
            Glyph(icon, Modifier.size(16.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, fontSize = AppType.body, lineHeight = AppType.bodyLine)
            if (description != null) Text(description, fontSize = AppType.small, lineHeight = 13.sp, color = colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Glyph("next", Modifier.size(14.dp), colors.muted)
    }
}

@Composable fun FormDialog(
    title: String,
    dismiss: () -> Unit,
    footer: (@Composable RowScope.() -> Unit)? = null,
    scaleTransition: Boolean = true,
    dividers: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = dismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val popupView = LocalView.current
        val window = (popupView.parent as? DialogWindowProvider)?.window
        SideEffect {
            removeNativePopupShadow(popupView)
            window?.let {
                if (it.attributes.windowAnimations != 0) it.setWindowAnimations(0)
                if (it.attributes.dimAmount != .3f) it.setDimAmount(.3f)
            }
        }
        var entered by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { entered = true }
        val opacity by animateFloatAsState(if (entered) 1f else 0f, tween(if (LocalMotionEnabled.current) 150 else 0), label = "dialog opacity")
        val scale by animateFloatAsState(if (entered || !scaleTransition) 1f else .99f, tween(if (LocalMotionEnabled.current) 150 else 0), label = "dialog scale")
        val scroll = rememberScrollState()
        BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 20.dp), contentAlignment = Alignment.Center) {
            val colors = LocalColors.current
            val shape = RoundedCornerShape(20.dp)
            // Keep the opaque surface and heading outside the scrolling body.
            Column(Modifier.widthIn(max = 520.dp).fillMaxWidth().heightIn(max = maxHeight.coerceAtMost(680.dp))
                .graphicsLayer(alpha = opacity, scaleX = scale, scaleY = scale)
                .clip(shape).background(colors.panel).border(1.dp, colors.muted.copy(alpha = .08f), shape)) {
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 10.dp, top = 10.dp, bottom = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(title, modifier = Modifier.weight(1f), style = MiuixTheme.textStyles.title3, color = colors.text,
                        maxLines = 2, overflow = TextOverflow.Ellipsis)
                    IconAction("close", "关闭", onClick = dismiss)
                }
                if (dividers) Divider()
                Box(Modifier.weight(1f, fill = false).clipToBounds()) {
                    Column(Modifier.fillMaxWidth().verticalScroll(scroll).padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
                    if (scroll.canScrollBackward) Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(12.dp)
                        .background(Brush.verticalGradient(listOf(colors.panel, colors.panel.copy(alpha = 0f)))))
                    if (scroll.canScrollForward) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(12.dp)
                        .background(Brush.verticalGradient(listOf(colors.panel.copy(alpha = 0f), colors.panel))))
                }
                if (footer != null) {
                    if (dividers) Divider()
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp), content = footer)
                }
            }
        }
    }
}
@Composable fun ConfirmDialog(vm: MainViewModel, title: String, description: String, dismiss: () -> Unit, confirm: suspend () -> Unit) {
    FormDialog(title, { if (!vm.working) dismiss() }) {
        Hint(description)
        Action(if (vm.working) "正在处理…" else "确认", Modifier.fillMaxWidth(), enabled = !vm.working, primary = true) {
            vm.work { confirm(); dismiss() }
        }
    }
}
@Composable fun Photo(vm: MainViewModel, url: String?, description: String, modifier: Modifier = Modifier, fit: Boolean = false,
    onLoaded: ((IntSize) -> Unit)? = null) {
    val current = LocalSession.current
    val full = if (url?.startsWith('/') == true) current?.baseUrl + url else url
    AsyncImage(model = ImageRequest.Builder(LocalContext.current).data(full)
        .memoryCacheKey("${current?.baseUrl}:${current?.user?.id}:$full")
        .diskCachePolicy(CachePolicy.DISABLED).build(), imageLoader = LocalImages.current,
        contentDescription = description, modifier = modifier, contentScale = if (fit) ContentScale.Fit else ContentScale.Crop,
        onSuccess = { state -> onLoaded?.invoke(IntSize(state.result.image.width, state.result.image.height)) })
}
fun copy(context: Context, value: String, sensitive: Boolean = false) {
    val clip = ClipData.newPlainText("映屿", value)
    if (sensitive) clip.description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
}
fun share(context: Context, value: String) {
    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, value), "分享图片链接"))
}
fun query(value: String): String = URLEncoder.encode(value, "UTF-8")
