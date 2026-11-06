package io.github.qiuyuxc.yingyu

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.utils.overScrollVertical

@OptIn(ExperimentalFoundationApi::class)
@Composable fun GalleryScreen(vm: MainViewModel, admin: Boolean = false, album: Album? = null) {
    var search by rememberSaveable(admin, album?.id) { mutableStateOf("") }
    var debounced by rememberSaveable(admin, album?.id) { mutableStateOf(search) }
    var filter by rememberSaveable { mutableStateOf("all") }
    var sort by rememberSaveable { mutableStateOf("newest") }
    var sorting by remember { mutableStateOf(false) }
    var quickMenu by remember { mutableStateOf<String?>(null) }
    var detail by remember { mutableStateOf<HostedImage?>(null) }
    var moving by remember { mutableStateOf<HostedImage?>(null) }
    var deleting by remember { mutableStateOf<HostedImage?>(null) }
    var selectionMode by rememberSaveable { mutableStateOf(false) }
    var selectedIds by rememberSaveable { mutableStateOf<Set<String>>(emptySet()) }
    var batchAction by remember { mutableStateOf<String?>(null) }
    var batchMenu by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val clearSelection = { selectionMode = false; selectedIds = emptySet<String>() }
    LaunchedEffect(search) {
        delay(300)
        if (debounced != search) { debounced = search; clearSelection() }
    }
    val path = (if (admin) "/api/admin/images" else "/api/images") + "?search=${query(debounced)}" +
        if (admin) "" else "&sort=$sort" + (album?.let { "&albumId=${it.id}" } ?: "") +
            when (filter) { "starred" -> "&starred=true"; "private", "public" -> "&visibility=$filter"; else -> "" }
    val feed = rememberFeed(vm, path, "images", if (admin) 30 else 40)
    val images = feed.items.map(HostedImage::from)
    val listView = vm.galleryView == "list"
    val gridState = rememberLazyGridState()
    LoadMoreOnScroll(gridState, feed)
    val sortOptions = listOf("newest" to "最新上传", "oldest" to "最早上传", "largest" to "文件大小", "name" to "名称")
    val showMenu: (String) -> Unit = { id -> focus.clearFocus(); keyboard?.hide(); quickMenu = id }
    val finishBatch: (ImageBatchResult) -> Unit = { result ->
        selectedIds = result.failed.keys.toSet()
        selectionMode = selectedIds.isNotEmpty()
        vm.message = if (result.failed.isEmpty()) "已处理 ${result.completed.size} 张图片" else
            "已处理 ${result.completed.size} 张，${result.failed.size} 张未完成：" + result.failed.values.first()
    }
    val patchSelection: (org.json.JSONObject) -> Unit = { patch ->
        batchMenu = false
        val ids = selectedIds
        vm.work { finishBatch(vm.editImages(ids, "PATCH", patch)) }
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        FeedRefresh(vm, feed, Modifier.widthIn(max = 840.dp).fillMaxSize()) {
            LazyVerticalGrid(columns = if (listView) GridCells.Fixed(1) else GridCells.Adaptive(136.dp), state = gridState,
                contentPadding = PaddingValues(start = AppSpacing.pagePadding, end = AppSpacing.pagePadding, top = 12.dp,
                    bottom = contentBottomPadding(vm) + if (selectionMode) 64.dp else 0.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize().overScrollVertical(), overscrollEffect = null) {
                item(span = { GridItemSpan(maxLineSpan) }, key = "heading") {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        PageHeader(if (admin) "图片管理" else album?.name ?: "我的图片",
                            if (!feed.ready) "正在加载图片…" else "${feed.total} 张图片",
                            onBack = if (LocalScreenRoute.current.isNotEmpty()) ({ vm.goBack() }) else null) {
                            IconAction("refresh", "刷新图片") { vm.refresh(feed) }
                        }
                        if (!admin) GalleryNotices(vm)
                        Field(if (admin) "搜索图片名称或上传者" else "搜索图片名称", search, { search = it.take(100) },
                            showLabel = false, placeholder = if (admin) "搜索图片名称或上传者" else "搜索图片名称", icon = "search")
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(Modifier.weight(1f)) {
                                if (!admin) Choices(listOf("all" to "全部", "starred" to "收藏", "public" to "公开", "private" to "私密"), filter, {
                                    focus.clearFocus(); keyboard?.hide(); filter = it; clearSelection()
                                })
                                else Hint("长按图片可查看快捷操作")
                            }
                            Box {
                                IconAction(if (admin) "more" else "sort", "排序与视图") { focus.clearFocus(); keyboard?.hide(); sorting = true }
                                if (sorting) MenuPopup({ sorting = false }) {
                                    if (!admin) {
                                        sortOptions.forEach { (key, label) -> MenuOption(label, checked = sort == key) {
                                            sorting = false; sort = key; clearSelection()
                                        } }
                                        Divider()
                                    }
                                    MenuOption("网格视图", "images", checked = !listView) { sorting = false; vm.galleryLayout("grid") }
                                    MenuOption("列表视图", "notice", checked = listView) { sorting = false; vm.galleryLayout("list") }
                                    if (images.isNotEmpty()) MenuOption("选择多张", "check", enabled = !vm.working) { sorting = false; selectionMode = true }
                                }
                            }
                        }
                        if (selectionMode) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Hint("已选 ${selectedIds.size} 张")
                            Action("全选已加载图片", compact = true) {
                                selectedIds = if (images.all { it.id in selectedIds }) emptySet() else images.map { it.id }.toSet()
                            }
                        }
                        FeedProblem(feed)
                    }
                }
                if (feed.ready && !feed.loading && feed.error == null && images.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }, key = "empty") {
                    val filtered = search.isNotEmpty() || filter != "all"
                    GlassCard(Modifier.fillMaxWidth()) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Glyph("images", Modifier.size(30.dp))
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(if (filtered) "没有找到图片" else "这里还没有图片", fontSize = AppType.section, lineHeight = 19.sp)
                                Hint(if (filtered) "试试其他搜索词或筛选条件。" else "上传图片后，就能在这里整理和分享。")
                            }
                        }
                        if (filtered) Action("清除筛选") { search = ""; filter = "all"; clearSelection() }
                        else if (!admin) Action("上传图片", primary = true) { vm.selectTab(2) }
                    }
                }
                items(images, key = { it.id }) { image ->
                    Box(Modifier.animateItem()) {
                        GalleryImageCard(vm, image, listView, admin, selectionMode, image.id in selectedIds,
                            open = {
                                if (selectionMode) selectedIds = if (image.id in selectedIds) selectedIds - image.id else selectedIds + image.id
                                else detail = image
                            }, menu = { showMenu(image.id) }, longPress = {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                if (selectionMode) selectedIds = selectedIds + image.id else showMenu(image.id)
                            })
                        if (quickMenu == image.id) MenuPopup({ quickMenu = null }) {
                            MenuOption("查看详情", "images") { quickMenu = null; detail = image }
                            MenuOption("复制链接", "copy") { quickMenu = null; copy(context, image.url); vm.message = "链接已复制" }
                            MenuOption("分享", "share") { quickMenu = null; share(context, image.url) }
                            if (!admin) {
                                MenuOption("移动到相册", "albums", enabled = !vm.working) { quickMenu = null; moving = image }
                                MenuOption(if (image.starred) "取消收藏" else "收藏", "star", enabled = !vm.working) {
                                    quickMenu = null; vm.work { vm.api.request("/api/images/${image.id}", "PATCH", jsonOf("starred" to !image.starred)) }
                                }
                            }
                            MenuOption("选择多张", "check", enabled = !vm.working) { quickMenu = null; selectionMode = true; selectedIds = selectedIds + image.id }
                            Divider()
                            MenuOption("删除图片", "trash", danger = true, enabled = !vm.working) { quickMenu = null; deleting = image }
                        }
                    }
                }
                item(span = { GridItemSpan(maxLineSpan) }, key = "footer") { FeedFooter(feed, "张图片") }
            }
        }
        if (selectionMode) GlassCard(Modifier.align(Alignment.BottomCenter).widthIn(max = 808.dp).fillMaxWidth()
            .padding(horizontal = AppSpacing.pagePadding).padding(bottom = contentBottomPadding(vm) - AppSpacing.pageGap),
            padding = PaddingValues(8.dp), spacing = 0.dp) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("已选 ${selectedIds.size} 张", modifier = Modifier.weight(1f), fontSize = AppType.caption, lineHeight = AppType.captionLine)
                if (!admin) IconAction("albums", "批量移动到相册", enabled = selectedIds.isNotEmpty() && !vm.working) { batchAction = "move" }
                Box {
                    IconAction("more", "批量操作", enabled = selectedIds.isNotEmpty() && !vm.working) { batchMenu = true }
                    if (batchMenu) MenuPopup({ batchMenu = false }) {
                        MenuOption("复制链接", "copy") {
                            batchMenu = false; copy(context, images.filter { it.id in selectedIds }.joinToString("\n") { it.url }); vm.message = "链接已复制"
                        }
                        if (!admin) {
                            MenuOption("设为公开", "globe") { patchSelection(jsonOf("visibility" to "public")) }
                            MenuOption("设为私密", "lock") { patchSelection(jsonOf("visibility" to "private")) }
                            MenuOption("收藏", "star") { patchSelection(jsonOf("starred" to true)) }
                            MenuOption("取消收藏", "star") { patchSelection(jsonOf("starred" to false)) }
                        }
                    }
                }
                IconAction("trash", "删除选中的图片", enabled = selectedIds.isNotEmpty() && !vm.working, color = Color(0xFFCA6262)) { batchAction = "delete" }
                IconAction("close", "退出多选", enabled = !vm.working) { clearSelection() }
            }
        }
    }
    detail?.let { image -> ImageDialog(vm, image, admin) { detail = null } }
    moving?.let { image -> MoveImageDialog(vm, image) { moving = null } }
    deleting?.let { image -> DeleteImageDialog(vm, image, admin, { deleting = null }) { deleting = null } }
    if (batchAction == "move") BatchMoveDialog(vm, selectedIds, { batchAction = null }) { result -> batchAction = null; finishBatch(result) }
    if (batchAction == "delete") ConfirmDialog(vm, "删除 ${selectedIds.size} 张图片？", "所选图片将从存储中删除，成功后归还空间，此操作无法撤销。", { batchAction = null }) {
        finishBatch(vm.editImages(selectedIds, "DELETE", admin = admin))
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable private fun GalleryImageCard(vm: MainViewModel, image: HostedImage, listView: Boolean, admin: Boolean,
    selectionMode: Boolean, checked: Boolean, open: () -> Unit, menu: () -> Unit, longPress: () -> Unit) {
    val colors = LocalColors.current
    val shape = RoundedCornerShape(14.dp)
    val modifier = Modifier.fillMaxWidth().clip(shape).background(colors.panel.copy(alpha = .9f))
        .border(1.dp, if (checked) colors.accent else colors.muted.copy(alpha = .08f), shape)
        .semantics { selected = checked }.combinedClickable(onClick = open, onLongClickLabel = "图片操作", onLongClick = longPress)
    @Composable fun Metadata(modifier: Modifier) {
        Column(modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(image.name, fontSize = AppType.body, lineHeight = AppType.bodyLine, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(if (admin) "${image.owner ?: "用户"} · ${bytes(image.size)}" else bytes(image.size),
                fontSize = AppType.small, lineHeight = 13.sp, color = colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (listView) Hint(if (image.visibility == "private") "私密" else "公开")
        }
    }
    @Composable fun Preview(modifier: Modifier) {
        Box(modifier) {
            Photo(vm, image.url, image.name, Modifier.fillMaxSize())
            if (selectionMode) Box(Modifier.align(Alignment.TopStart).padding(6.dp).size(24.dp).clip(RoundedCornerShape(8.dp))
                .background(if (checked) colors.accent else colors.panel.copy(alpha = .95f)), contentAlignment = Alignment.Center) {
                if (checked) Glyph("check", Modifier.size(15.dp), if (colors.dark) colors.background else Color.White)
            } else {
                if (image.starred) Box(Modifier.align(Alignment.TopStart).padding(6.dp).clip(RoundedCornerShape(8.dp))
                    .background(colors.panel.copy(alpha = .95f)).padding(6.dp)) { Glyph("star", Modifier.size(13.dp)) }
                if (!listView) Box(Modifier.align(Alignment.TopEnd).padding(4.dp).clip(RoundedCornerShape(10.dp)).background(colors.panel.copy(alpha = .92f))) {
                    IconAction("more", "图片操作：" + image.name, onClick = menu)
                }
            }
            if (image.visibility == "private" && !listView) Text("私密", modifier = Modifier.align(Alignment.BottomStart).padding(6.dp)
                .background(colors.panel.copy(alpha = .95f), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
                fontSize = AppType.small, lineHeight = 13.sp)
        }
    }
    if (listView) Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Preview(Modifier.padding(8.dp).size(80.dp, 60.dp).clip(RoundedCornerShape(9.dp)))
        Metadata(Modifier.weight(1f))
        if (!selectionMode) IconAction("more", "图片操作：" + image.name, Modifier.padding(end = 8.dp), onClick = menu)
    } else Column(modifier) {
        Preview(Modifier.fillMaxWidth().aspectRatio(4f / 3f))
        Metadata(Modifier.fillMaxWidth())
    }
}
