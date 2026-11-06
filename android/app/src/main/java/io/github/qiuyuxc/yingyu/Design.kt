package io.github.qiuyuxc.yingyu

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.darkColorScheme
import top.yukonga.miuix.kmp.theme.lightColorScheme
import top.yukonga.miuix.kmp.theme.defaultTextStyles
import top.yukonga.miuix.kmp.theme.Colors
import top.yukonga.miuix.kmp.theme.LocalContentColor

// Match the web workspace's 11px body, small controls and restrained headings.
// Use sp for text so Android's user-selected font scale still applies.
object AppType {
    val body = 11.sp
    val caption = 10.sp
    val small = 9.sp
    val section = 13.sp
    val title = 16.sp
    val stat = 18.sp
    val heading = 22.sp
    val bodyLine = 17.sp
    val captionLine = 15.sp
}

object AppSpacing {
    val pagePadding = 16.dp
    val pageGap = 12.dp
    val cardPadding = 14.dp
    val cardGap = 10.dp
    val cardRadius = 16.dp
    val controlRadius = 10.dp
    val navigationHeight = 54.dp
    val navigationPadding = 8.dp
    val navigationRadius = 26.dp
    val contentWidth = 640.dp
}

data class AppColors(val dark: Boolean, val accent: Color, val background: Color, val panel: Color, val text: Color, val muted: Color)
val LocalColors = staticCompositionLocalOf { appPaletteColors("mono", false) }
val LocalMotionEnabled = staticCompositionLocalOf { true }
val LocalScreenRoute = staticCompositionLocalOf { "" }

internal fun appPaletteColors(palette: String, dark: Boolean): AppColors {
    if (palette == "mono") return if (dark)
        AppColors(true, Color(0xFFCACACA), Color(0xFF171717), Color(0xFF252525), Color(0xFFDADADA), Color(0xFFA0A0A0))
    else AppColors(false, Color(0xFF343434), Color(0xFFF5F5F5), Color.White, Color(0xFF2C2C2C), Color(0xFF6B6B6B))
    val accent = if (palette == "blue") {
        if (dark) Color(0xFFA0BDDB) else Color(0xFF4C729A)
    } else if (dark) Color(0xFFA7C5AD) else Color(0xFF52785E)
    return AppColors(dark, accent, if (dark) Color(0xFF191C1C) else Color(0xFFF0F4F0),
        if (dark) Color(0xFF2B3030) else Color.White, if (dark) Color(0xFFE9EDEA) else Color(0xFF263A30),
        if (dark) Color(0xFFACB5AF) else Color(0xFF78867C))
}

internal fun appComponentColors(colors: AppColors, monochrome: Boolean): Colors {
    val base = if (colors.dark) darkColorScheme(primary = colors.accent, onPrimary = colors.background, background = colors.background)
        else lightColorScheme(primary = colors.accent, onPrimary = Color.White, background = colors.background)
    if (!monochrome) return base
    val onAccent = if (colors.dark) colors.background else Color.White
    val raised = if (colors.dark) Color(0xFF303030) else Color(0xFFEEEEEE)
    val disabled = if (colors.dark) Color(0xFF757575) else Color(0xFF999999)
    return base.copy(
        primary = colors.accent, onPrimary = onAccent, primaryVariant = colors.accent, onPrimaryVariant = onAccent,
        primaryContainer = colors.accent, onPrimaryContainer = onAccent,
        disabledPrimary = raised, disabledOnPrimary = disabled, disabledPrimaryButton = raised,
        disabledOnPrimaryButton = disabled, disabledPrimarySlider = raised,
        secondary = raised, onSecondary = colors.text, secondaryVariant = raised, onSecondaryVariant = colors.text,
        disabledSecondary = raised, disabledOnSecondary = disabled, disabledSecondaryVariant = raised, disabledOnSecondaryVariant = disabled,
        secondaryContainer = raised, onSecondaryContainer = colors.muted,
        secondaryContainerVariant = raised, onSecondaryContainerVariant = colors.muted,
        tertiaryContainer = raised, onTertiaryContainer = colors.accent, tertiaryContainerVariant = raised,
        background = colors.background, onBackground = colors.text, onBackgroundVariant = colors.muted,
        surface = colors.background, onSurface = colors.text, surfaceVariant = colors.panel,
        onSurfaceSecondary = colors.text, onSurfaceVariantSummary = colors.muted, onSurfaceVariantActions = colors.muted,
        disabledOnSurface = disabled, surfaceContainer = colors.panel, onSurfaceContainer = colors.text,
        onSurfaceContainerVariant = colors.muted, surfaceContainerHigh = raised, onSurfaceContainerHigh = colors.muted,
        surfaceContainerHighest = raised, onSurfaceContainerHighest = colors.text,
        outline = colors.muted.copy(alpha = .2f), dividerLine = colors.muted.copy(alpha = .08f),
        windowDimming = Color.Black.copy(alpha = .3f), sliderKeyPoint = colors.muted.copy(alpha = .3f),
        sliderKeyPointForeground = colors.accent, sliderBackground = colors.muted.copy(alpha = .12f),
    )
}

@Composable fun YingyuTheme(vm: MainViewModel, content: @Composable () -> Unit) {
    val dark = when (vm.theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    YingyuTheme(vm.palette, dark, !vm.reduceMotion, content)
}

@Composable internal fun YingyuTheme(palette: String, dark: Boolean, motionEnabled: Boolean = true, content: @Composable () -> Unit) {
    val colors = remember(palette, dark) { appPaletteColors(palette, dark) }
    val scheme = remember(colors, palette) { appComponentColors(colors, palette == "mono") }
    val typography = remember(palette) {
        val body = TextStyle(fontSize = AppType.body, lineHeight = AppType.bodyLine)
        val caption = TextStyle(fontSize = AppType.caption, lineHeight = AppType.captionLine)
        val section = TextStyle(fontSize = AppType.section, lineHeight = 19.sp, fontWeight = FontWeight.Medium)
        defaultTextStyles(
            main = body, paragraph = body, body1 = body, body2 = caption,
            button = body.copy(lineHeight = 16.sp, fontWeight = FontWeight.Medium),
            footnote1 = caption, footnote2 = caption.copy(fontSize = AppType.small, lineHeight = 13.sp),
            headline1 = section, headline2 = section, subtitle = caption.copy(fontWeight = FontWeight.Medium),
            title1 = TextStyle(fontSize = AppType.heading, lineHeight = 28.sp, fontWeight = if (palette == "mono") FontWeight.Medium else FontWeight.SemiBold),
            title2 = TextStyle(fontSize = AppType.stat, lineHeight = 24.sp, fontWeight = if (palette == "mono") FontWeight.Medium else FontWeight.SemiBold),
            title3 = TextStyle(fontSize = AppType.title, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
            title4 = section,
        )
    }
    MiuixTheme(colors = scheme, textStyles = typography) {
        // Miuix 0.9.4's colors overload leaves the content color at its black default.
        // Keep text style colors unspecified so buttons can still provide their own contrast color.
        CompositionLocalProvider(LocalColors provides colors, LocalContentColor provides colors.text,
            LocalMotionEnabled provides motionEnabled, content = content)
    }
}

@Composable fun GlassCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(AppSpacing.cardPadding),
    spacing: androidx.compose.ui.unit.Dp = AppSpacing.cardGap,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalColors.current
    val shape = RoundedCornerShape(AppSpacing.cardRadius)
    Column(modifier.animateContentSize(tween(if (LocalMotionEnabled.current) 180 else 0)).clip(shape).background(colors.panel.copy(alpha = if (colors.dark) .96f else .88f))
        .border(1.dp, colors.muted.copy(alpha = .10f), shape)
        .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier).padding(padding),
        verticalArrangement = Arrangement.spacedBy(spacing), content = content)
}
@Composable fun Heading(title: String, modifier: Modifier = Modifier, subtitle: String? = null) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(title, color = LocalColors.current.text, style = MiuixTheme.textStyles.title1, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (!subtitle.isNullOrBlank()) Hint(subtitle)
    }
}
@Composable fun PageHeader(
    title: String,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (onBack != null) IconAction("back", "返回", onClick = onBack)
        Heading(title, Modifier.weight(1f), subtitle)
        actions()
    }
}
@Composable fun Hint(text: String) { Text(text, fontSize = AppType.caption, color = LocalColors.current.muted, lineHeight = AppType.captionLine) }
@Composable fun AppProgress(value: Float, modifier: Modifier = Modifier, height: Dp = 4.dp) {
    val progress by animateFloatAsState(value.coerceIn(0f, 1f), tween(if (LocalMotionEnabled.current) 220 else 0), label = "progress")
    Box(modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(height)).background(LocalColors.current.accent.copy(alpha = .12f))) {
        Box(Modifier.fillMaxWidth(progress).fillMaxHeight().background(LocalColors.current.accent))
    }
}
@Composable fun Action(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, primary: Boolean = false, compact: Boolean = false, onClick: () -> Unit) {
    Button(onClick = onClick, modifier = modifier, enabled = enabled, minHeight = if (compact) 28.dp else 32.dp,
        minWidth = 0.dp, cornerRadius = AppSpacing.controlRadius,
        insideMargin = PaddingValues(horizontal = if (compact) 10.dp else 12.dp, vertical = if (compact) 5.dp else 7.dp),
        colors = if (primary) ButtonDefaults.buttonColorsPrimary() else ButtonDefaults.buttonColors()) {
        Text(text, fontSize = if (compact) AppType.caption else AppType.body, lineHeight = 16.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable fun Glyph(name: String, modifier: Modifier = Modifier, color: Color = LocalColors.current.accent) {
    Canvas(modifier.size(20.dp)) {
        val scale = size.minDimension / 24; val stroke = Stroke(1.65f * scale, cap = StrokeCap.Round)
        fun line(x: Float, y: Float, xx: Float, yy: Float) = drawLine(color, Offset(x * scale, y * scale), Offset(xx * scale, yy * scale), stroke.width, StrokeCap.Round)
        fun rect(x: Float, y: Float, width: Float, height: Float, radius: Float = 3f) = drawRoundRect(color, Offset(x * scale, y * scale), Size(width * scale, height * scale), androidx.compose.ui.geometry.CornerRadius(radius * scale), style = stroke)
        when (name) {
            "images" -> { rect(3f, 3f, 18f, 18f); drawCircle(color, 1.5f * scale, Offset(16f * scale, 8f * scale)); line(4f, 17f, 9f, 11f); line(9f, 11f, 15f, 18f); line(15f, 18f, 19f, 14f) }
            "albums" -> { rect(3f, 7f, 18f, 14f); line(4f, 4f, 10f, 4f); line(10f, 4f, 13f, 7f) }
            "upload" -> { line(12f, 16f, 12f, 3f); line(7f, 8f, 12f, 3f); line(12f, 3f, 17f, 8f); line(3f, 15f, 3f, 21f); line(3f, 21f, 21f, 21f); line(21f, 21f, 21f, 15f) }
            "user" -> { drawCircle(color, 4f * scale, Offset(12f * scale, 7f * scale), style = stroke); drawArc(color, 180f, 180f, false, Offset(4f * scale, 14f * scale), Size(16f * scale, 14f * scale), style = stroke) }
            "back" -> { line(14f, 5f, 7f, 12f); line(7f, 12f, 14f, 19f) }
            "next" -> { line(9f, 5f, 16f, 12f); line(16f, 12f, 9f, 19f) }
            "edit" -> { line(4f, 20f, 8f, 19f); line(8f, 19f, 21f, 6f); line(21f, 6f, 18f, 3f); line(18f, 3f, 5f, 16f); line(5f, 16f, 4f, 20f); line(14f, 7f, 18f, 11f) }
            "settings" -> { drawCircle(color, 7f * scale, Offset(12f * scale, 12f * scale), style = stroke); drawCircle(color, 2.5f * scale, Offset(12f * scale, 12f * scale), style = stroke); for (i in 0 until 8) { val angle = Math.PI * i / 4; line(12f + kotlin.math.cos(angle).toFloat() * 8f, 12f + kotlin.math.sin(angle).toFloat() * 8f, 12f + kotlin.math.cos(angle).toFloat() * 10.5f, 12f + kotlin.math.sin(angle).toFloat() * 10.5f) } }
            "help" -> { drawCircle(color, 9f * scale, Offset(12f * scale, 12f * scale), style = stroke); drawArc(color, 180f, 250f, false, Offset(9f * scale, 6f * scale), Size(6f * scale, 6f * scale), style = stroke); line(12f, 12f, 12f, 14f); drawCircle(color, .9f * scale, Offset(12f * scale, 18f * scale)) }
            "down" -> { line(6f, 9f, 12f, 15f); line(12f, 15f, 18f, 9f) }
            "close" -> { line(6f, 6f, 18f, 18f); line(18f, 6f, 6f, 18f) }
            "search" -> { drawCircle(color, 7f * scale, Offset(10f * scale, 10f * scale), style = stroke); line(15f, 15f, 21f, 21f) }
            "more" -> { for (x in listOf(5f, 12f, 19f)) drawCircle(color, 1.5f * scale, Offset(x * scale, 12f * scale)) }
            "refresh" -> { drawArc(color, -50f, 285f, false, Offset(4f * scale, 4f * scale), Size(16f * scale, 16f * scale), style = stroke); line(19f, 3f, 19f, 8f); line(14f, 8f, 19f, 8f) }
            "copy" -> { rect(8f, 8f, 13f, 13f); line(3f, 15f, 3f, 3f); line(3f, 3f, 15f, 3f) }
            "share" -> { rect(4f, 11f, 16f, 10f); line(12f, 15f, 12f, 3f); line(7f, 7f, 12f, 3f); line(12f, 3f, 17f, 7f) }
            "download" -> { line(12f, 3f, 12f, 16f); line(7f, 11f, 12f, 16f); line(12f, 16f, 17f, 11f); line(4f, 20f, 20f, 20f) }
            "trash" -> { line(3f, 6f, 21f, 6f); line(9f, 3f, 15f, 3f); rect(6f, 6f, 12f, 15f, 2f); line(10f, 10f, 10f, 17f); line(14f, 10f, 14f, 17f) }
            "sort" -> { line(5f, 6f, 19f, 6f); line(5f, 12f, 15f, 12f); line(5f, 18f, 11f, 18f) }
            "lock" -> { rect(5f, 10f, 14f, 11f); drawArc(color, 180f, 180f, false, Offset(8f * scale, 3f * scale), Size(8f * scale, 14f * scale), style = stroke); line(12f, 14f, 12f, 17f) }
            "mail" -> { rect(3f, 5f, 18f, 14f); line(3f, 6f, 12f, 13f); line(12f, 13f, 21f, 6f) }
            "space" -> { rect(3f, 4f, 18f, 16f); line(3f, 14f, 21f, 14f); drawCircle(color, 1f * scale, Offset(17f * scale, 17f * scale)) }
            "appearance" -> { drawCircle(color, 8f * scale, Offset(12f * scale, 12f * scale), style = stroke); drawArc(color, -90f, 180f, true, Offset(4f * scale, 4f * scale), Size(16f * scale, 16f * scale)) }
            "globe" -> { drawCircle(color, 9f * scale, Offset(12f * scale, 12f * scale), style = stroke); drawOval(color, Offset(8f * scale, 3f * scale), Size(8f * scale, 18f * scale), style = stroke); line(3f, 12f, 21f, 12f) }
            "notice" -> { rect(4f, 3f, 16f, 18f); line(8f, 8f, 16f, 8f); line(8f, 12f, 16f, 12f); line(8f, 16f, 13f, 16f) }
            "key" -> { drawCircle(color, 5f * scale, Offset(8f * scale, 8f * scale), style = stroke); line(12f, 12f, 21f, 21f); line(16f, 16f, 19f, 13f) }
            "eye", "eye-off" -> { drawOval(color, Offset(2f * scale, 6f * scale), Size(20f * scale, 12f * scale), style = stroke); drawCircle(color, 3f * scale, Offset(12f * scale, 12f * scale), style = stroke); if (name == "eye-off") line(3f, 3f, 21f, 21f) }
            "check" -> { line(5f, 12f, 10f, 17f); line(10f, 17f, 20f, 6f) }
            "star" -> {
                val path = Path(); (0 until 10).forEach { i ->
                    val angle = Math.PI * i / 5 - Math.PI / 2; val radius = (if (i % 2 == 0) 10f else 4.5f) * scale
                    val x = 12 * scale + kotlin.math.cos(angle).toFloat() * radius; val y = 12 * scale + kotlin.math.sin(angle).toFloat() * radius
                    if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }; path.close(); drawPath(path, color, style = stroke)
            }
            else -> { line(12f, 4f, 12f, 20f); line(4f, 12f, 20f, 12f) }
        }
    }
}
