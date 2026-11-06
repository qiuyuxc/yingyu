package io.github.qiuyuxc.yingyu

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import coil3.ImageLoader
import coil3.gif.AnimatedImageDecoder
import coil3.gif.GifDecoder
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.qmdeve.liquidglass.widget.LiquidGlassView
import top.yukonga.miuix.kmp.basic.Text
import kotlin.math.roundToInt

val LocalImages = staticCompositionLocalOf<ImageLoader> { error("Image loader unavailable") }
val LocalSession = staticCompositionLocalOf<ClientSession?> { null }

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val root = FrameLayout(this)
        // Keep the sampling source and the glass as siblings: capturing the glass itself recurses.
        val source = FrameLayout(this)
        val content = ComposeView(this).apply { id = R.id.app_content; setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed) }
        source.addView(content, FrameLayout.LayoutParams(-1, -1))
        root.addView(source, FrameLayout.LayoutParams(-1, -1))
        val navigation = ComposeView(this).apply { id = R.id.app_navigation; setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed) }
        root.addView(navigation, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        setContentView(root)
        content.setContent {
            YingyuTheme(vm) {
                val colors = LocalColors.current
                SideEffect {
                    WindowCompat.getInsetsController(window, window.decorView).apply {
                        isAppearanceLightStatusBars = !colors.dark; isAppearanceLightNavigationBars = !colors.dark
                    }
                }
                AppContent(vm)
            }
        }
        navigation.setContent { YingyuTheme(vm) { GlassNavigation(vm, source) } }
        if (savedInstanceState == null) receive(intent)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); receive(intent) }
    @Suppress("DEPRECATION") private fun receive(intent: Intent) {
        val uris = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
            else -> emptyList()
        }
        if (uris.isNotEmpty()) vm.receiveShared(uris)
    }
}

@Composable private fun AppContent(vm: MainViewModel) {
    val session by vm.session.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, vm) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) vm.syncSite() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val loader = remember(session?.baseUrl, session?.user?.id) {
        ImageLoader.Builder(context).components {
            add(OkHttpNetworkFetcherFactory(callFactory = { vm.api.imageHttp }))
            if (Build.VERSION.SDK_INT >= 28) add(AnimatedImageDecoder.Factory()) else add(GifDecoder.Factory())
        }.diskCache(null).build()
    }
    DisposableEffect(loader) { onDispose { loader.shutdown() } }
    LaunchedEffect(vm.message) { vm.message?.let { Toast.makeText(context, it, Toast.LENGTH_LONG).show(); vm.message = null } }
    BackHandler(enabled = session != null && vm.navigation.canGoBack) { vm.goBack() }
    val colors = LocalColors.current
    val motion = LocalMotionEnabled.current
    CompositionLocalProvider(LocalImages provides loader, LocalSession provides session) {
        Box(Modifier.fillMaxSize().background(colors.background)
            .background(Brush.verticalGradient(listOf(colors.accent.copy(alpha = if (colors.dark) .13f else .09f), Color.Transparent)))
            .statusBarsPadding().imePadding()) {
            key(session?.baseUrl, session?.user?.id) {
                val savedScreens = rememberSaveableStateHolder()
                if (session == null) AuthScreen(vm) else {
                    AnimatedContent(targetState = vm.navigation.destination, modifier = Modifier.fillMaxSize().clipToBounds(),
                        contentKey = { it.key }, label = "screen",
                        transitionSpec = {
                            val duration = if (motion) 220 else 0
                            val back = vm.navigation.returning || (targetState.page.isEmpty() && initialState.page.isEmpty() && targetState.tab < initialState.tab)
                            (fadeIn(tween(duration)) + slideInHorizontally(tween(duration)) { if (back) -it / 8 else it / 8 })
                                .togetherWith(fadeOut(tween(duration / 2)) + slideOutHorizontally(tween(duration)) { if (back) it / 12 else -it / 12 })
                        }) { destination ->
                        savedScreens.SaveableStateProvider(destination.key) {
                            CompositionLocalProvider(LocalScreenRoute provides destination.page) {
                                when (destination.page) {
                                    "album" -> GalleryScreen(vm, album = destination.album)
                                    "admin" -> AdminScreen(vm)
                                    "admin-images" -> GalleryScreen(vm, admin = true)
                                    "admin-quota" -> QuotaScreen(vm, admin = true)
                                    "quota" -> QuotaScreen(vm)
                                    "announcements" -> AnnouncementsScreen(vm)
                                    "account" -> AccountScreen(vm)
                                    "password" -> PasswordScreen(vm)
                                    "email" -> EmailScreen(vm)
                                    "tokens" -> TokensScreen(vm)
                                    "avatar-history" -> AvatarsScreen(vm)
                                    "settings" -> AppSettingsScreen(vm)
                                    "appearance" -> AppearanceScreen(vm)
                                    "help" -> HelpScreen(vm)
                                    "licenses" -> LicensesScreen(vm)
                                    else -> when (destination.tab) {
                                        0 -> GalleryScreen(vm)
                                        1 -> AlbumsScreen(vm)
                                        2 -> UploadScreen(vm)
                                        else -> MineScreen(vm, session!!.user)
                                    }
                                }
                            }
                        }
                    }
                    AppAnnouncements(vm)
                }
            }
        }
    }
}

@Composable private fun GlassNavigation(vm: MainViewModel, source: ViewGroup) {
    val session by vm.session.collectAsStateWithLifecycle()
    val visible = session != null && vm.page.isEmpty() && WindowInsets.ime.getBottom(LocalDensity.current) == 0
    val colors = LocalColors.current
    val shape = RoundedCornerShape(AppSpacing.navigationRadius)
    val drag = remember { TabBarDrag() }
    val haptics = LocalHapticFeedback.current
    val direction = LocalLayoutDirection.current
    AnimatedVisibility(visible, enter = fadeIn(tween(if (LocalMotionEnabled.current) 180 else 0)) + slideInVertically(tween(if (LocalMotionEnabled.current) 180 else 0)) { it / 3 },
        exit = fadeOut(tween(if (LocalMotionEnabled.current) 120 else 0))) {
    Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp, vertical = AppSpacing.navigationPadding), contentAlignment = Alignment.Center) {
        BoxWithConstraints(Modifier.widthIn(max = 420.dp).fillMaxWidth().height(AppSpacing.navigationHeight)
            .clip(shape)
            .background(colors.panel.copy(alpha = if (colors.dark) .88f else .82f), shape)
            .border(1.dp, colors.panel.copy(alpha = .85f), shape)) {
            if (Build.VERSION.SDK_INT >= 33 && vm.glass) {
                AndroidView(factory = { context -> LiquidGlassView(context).apply {
                    val density = context.resources.displayMetrics.density
                    isClickable = false; isFocusable = false
                    setCornerRadius(AppSpacing.navigationRadius.value * density); setRefractionHeight(8 * density)
                    setRefractionOffset(12 * density); setDispersion(.06f); setBlurRadius(4 * density)
                    bind(source)
                } }, modifier = Modifier.matchParentSize(), update = { view ->
                    val tint = if (colors.dark) colors.background else Color.White
                    view.setTintColorRed(tint.red)
                    view.setTintColorGreen(tint.green)
                    view.setTintColorBlue(tint.blue)
                    view.setTintAlpha(if (colors.dark) .42f else .26f)
                })
            }
            val itemWidth = maxWidth / 4
            val widthPixels = with(LocalDensity.current) { maxWidth.toPx() }
            val itemPixels = widthPixels / 4
            DisposableEffect(widthPixels, direction) { onDispose { drag.cancel() } }
            val target = if (drag.active) drag.position else vm.tab.toFloat()
            val animated by animateFloatAsState(target, if (drag.active) snap() else tween(if (LocalMotionEnabled.current) 180 else 0), label = "tab position")
            val position = if (drag.active) drag.position else animated
            val preview = if (drag.active) drag.candidate else vm.tab
            Box(Modifier.offset { IntOffset((itemPixels * position).roundToInt(), 0) }.width(itemWidth).fillMaxHeight().padding(5.dp)
                .background(colors.accent.copy(alpha = if (colors.dark) .21f else .13f), RoundedCornerShape(21.dp)))
            Row(Modifier.fillMaxSize().pointerInput(widthPixels, direction) {
                fun localX(x: Float) = if (direction == LayoutDirection.Rtl) widthPixels - x else x
                detectHorizontalDragGestures(
                    onDragStart = { point -> drag.start(localX(point.x), widthPixels, vm.tab) },
                    onHorizontalDrag = { change, _ ->
                        change.consume()
                        val previous = drag.candidate
                        drag.move(localX(change.position.x), widthPixels)
                        if (previous != drag.candidate) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    },
                    onDragEnd = { drag.finish()?.let { vm.selectTab(it) } },
                    onDragCancel = { drag.cancel() },
                )
            }) {
                listOf("images" to "图片", "albums" to "相册", "upload" to "上传", "user" to "我的").forEachIndexed { index, (icon, label) ->
                    Column(Modifier.weight(1f).fillMaxHeight().padding(5.dp).clip(RoundedCornerShape(21.dp))
                        .semantics(mergeDescendants = true) { role = Role.Tab; selected = preview == index }
                        .clickable { if (!drag.active) vm.selectTab(index) }, verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.size(18.dp)) {
                            Glyph(icon, Modifier.size(18.dp), color = if (preview == index) colors.accent else colors.muted)
                            if (index == 3 && vm.hasUnreadNotices) Box(Modifier.align(Alignment.TopEnd).size(4.dp).clip(RoundedCornerShape(2.dp)).background(colors.accent))
                        }
                        Spacer(Modifier.height(2.dp))
                        Text(label, fontSize = AppType.small, lineHeight = 12.sp, color = if (preview == index) colors.accent else colors.muted)
                    }
                }
            }
        }
    }
}
}
