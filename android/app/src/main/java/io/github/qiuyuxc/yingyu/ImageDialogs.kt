package io.github.qiuyuxc.yingyu

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntSize
import top.yukonga.miuix.kmp.basic.Text

@Composable fun ImageDialog(vm: MainViewModel, image: HostedImage, admin: Boolean, dismiss: () -> Unit) {
    var deleting by remember { mutableStateOf(false) }
    var name by remember(image.id) { mutableStateOf(image.name) }
    var visibility by remember(image.id) { mutableStateOf(image.visibility) }
    var album by remember(image.id) { mutableStateOf(image.albumId ?: "") }
    var tab by rememberSaveable(image.id) { mutableStateOf("share") }
    var format by rememberSaveable { mutableStateOf("直链") }
    var scale by remember(image.id) { mutableFloatStateOf(1f) }
    var pan by remember(image.id) { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    var imageDimensions by remember(image.id) { mutableStateOf<IntSize?>(null) }
    var starred by remember(image.id) { mutableStateOf(image.starred) }
    val context = LocalContext.current
    val albumData = if (!admin && tab == "edit") resource(vm, "/api/albums") else Resource(loading = false)
    val windowSize = LocalWindowInfo.current.containerSize
    val previewHeight = with(LocalDensity.current) { (windowSize.height * .24f).toDp() }.coerceIn(140.dp, 220.dp)
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(image.mime)) { uri ->
        if (uri != null) vm.work("图片已保存") {
            try { context.contentResolver.openOutputStream(uri)?.use { vm.api.download(image.url, it) } ?: error("无法写入所选位置") }
            catch (error: Exception) { runCatching { context.contentResolver.delete(uri, null, null) }; throw error }
        }
    }
    FormDialog(if (admin) "审核图片" else "图片详情", { if (!vm.working) dismiss() }, scaleTransition = false, dividers = false, footer = {
        if (!admin && tab == "edit") {
            Action("保存修改", Modifier.weight(1f), enabled = !vm.working && name.isNotBlank() && albumData.data != null, primary = true) {
                vm.work("已保存") {
                    vm.api.request("/api/images/${image.id}", "PATCH",
                        jsonOf("name" to name.trim(), "visibility" to visibility, "albumId" to album.ifEmpty { null }))
                    dismiss()
                }
            }
        } else {
            Text(if (image.visibility == "private") "私密图片，访问原图需要登录" else "公开图片，可通过链接分享",
                modifier = Modifier.weight(1f), fontSize = AppType.small, lineHeight = AppType.captionLine, color = LocalColors.current.muted)
        }
        IconAction("trash", "删除图片", enabled = !vm.working, color = Color(0xFFCA6262)) { deleting = true }
    }) {
        Box(Modifier.fillMaxWidth().height(previewHeight).clip(RoundedCornerShape(12.dp)).background(LocalColors.current.background)
            .onSizeChanged { viewport = it; pan = boundedPan(pan, scale, viewport, imageDimensions) }
            .pointerInput(image.id) { detectTapGestures(onDoubleTap = { point ->
                scale = if (scale > 1.2f) 1f else 2f
                pan = boundedPan((point - Offset(viewport.width / 2f, viewport.height / 2f)) * (1f - scale), scale, viewport, imageDimensions)
            }) }
            .transformable(rememberTransformableState { centroid, zoom, movement, _ ->
                val next = (scale * zoom).coerceIn(1f, 5f)
                val relative = if (centroid == Offset.Unspecified) Offset.Zero else centroid - Offset(viewport.width / 2f, viewport.height / 2f)
                pan = boundedPan((pan - relative) * (next / scale) + relative + movement, next, viewport, imageDimensions)
                scale = next
            }, canPan = { scale > 1f })) {
            Photo(vm, image.url, image.name, Modifier.fillMaxSize().graphicsLayer(scaleX = scale, scaleY = scale, translationX = pan.x, translationY = pan.y), fit = true,
                onLoaded = { size -> imageDimensions = size; pan = boundedPan(pan, scale, viewport, size) })
            if (scale > 1.05f) Box(Modifier.align(Alignment.TopEnd).padding(5.dp).clip(RoundedCornerShape(10.dp)).background(LocalColors.current.panel)) {
                IconAction("refresh", "还原缩放") { scale = 1f; pan = Offset.Zero }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(image.name, fontSize = AppType.body, lineHeight = AppType.bodyLine, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Hint("${bytes(image.size)} · ${image.createdAt.take(10)}${image.owner?.let { " · $it" } ?: ""}")
        }
        if (!admin) Choices(listOf("share" to "分享图片", "edit" to "编辑信息"), tab, { tab = it }, enabled = !vm.working)
        if (!admin && tab == "edit") {
            Field("图片名称", name, { name = it.take(200) }, enabled = !vm.working)
            ResourceState(albumData, vm) { data ->
                val albums = data.getJSONArray("albums").mapObjects(Album::from)
                SelectionField("移动到相册", listOf("" to "未归入相册") + albums.map { it.id to it.name }, album, { album = it }, enabled = !vm.working)
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Hint("图片可见性")
                Choices(listOf("public" to "公开", "private" to "私密"), visibility, { visibility = it }, enabled = !vm.working)
                Hint(if (visibility == "private") "仅本人和管理员可查看原图。" else "持有链接的人可以查看原图。")
            }
        } else {
            Choices(listOf("直链", "Markdown", "HTML", "BBCode").map { it to it }, format, { format = it })
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(LocalColors.current.accent.copy(alpha = .06f)).padding(10.dp)) {
                Text(image.link(format), fontSize = AppType.small, lineHeight = AppType.captionLine, color = LocalColors.current.muted,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Action("复制链接", Modifier.weight(1f), primary = true) { copy(context, image.link(format)); vm.message = "链接已复制" }
                IconAction("share", "分享图片") { share(context, image.link(format)) }
                IconAction("download", "保存到文件", enabled = !vm.working) { save.launch(image.name) }
                if (!admin) IconAction("star", if (starred) "取消收藏" else "收藏", enabled = !vm.working,
                    color = if (starred) LocalColors.current.accent else LocalColors.current.muted) {
                    vm.work {
                        vm.api.request("/api/images/${image.id}", "PATCH", jsonOf("starred" to !starred)); starred = !starred
                    }
                }
            }
        }
    }
    if (deleting) DeleteImageDialog(vm, image, admin, { deleting = false }) { deleting = false; dismiss() }
}

internal fun boundedPan(value: Offset, scale: Float, viewport: IntSize, imageSize: IntSize? = null): Offset {
    if (viewport.width <= 0 || viewport.height <= 0) return Offset.Zero
    val image = imageSize?.takeIf { it.width > 0 && it.height > 0 } ?: viewport
    val fit = minOf(viewport.width.toFloat() / image.width, viewport.height.toFloat() / image.height)
    val x = ((image.width * fit * scale.coerceAtLeast(1f) - viewport.width) / 2).coerceAtLeast(0f)
    val y = ((image.height * fit * scale.coerceAtLeast(1f) - viewport.height) / 2).coerceAtLeast(0f)
    return Offset(if (x > 0f) value.x.coerceIn(-x, x) else 0f, if (y > 0f) value.y.coerceIn(-y, y) else 0f)
}

@Composable fun MoveImageDialog(vm: MainViewModel, image: HostedImage, dismiss: () -> Unit) {
    val data = resource(vm, "/api/albums")
    var album by remember(image.id) { mutableStateOf(image.albumId ?: "") }
    FormDialog("移动到相册", { if (!vm.working) dismiss() }, footer = {
        Action("确认移动", Modifier.weight(1f), primary = true, enabled = !vm.working && data.data != null && album != (image.albumId ?: "")) {
            vm.work("相册已更新") {
                vm.api.request("/api/images/${image.id}", "PATCH", jsonOf("albumId" to album.ifEmpty { null }))
                dismiss()
            }
        }
    }) {
        Text(image.name, fontSize = AppType.body, lineHeight = AppType.bodyLine, maxLines = 2, overflow = TextOverflow.Ellipsis)
        ResourceState(data, vm) { result ->
            val albums = result.getJSONArray("albums").mapObjects(Album::from)
            SelectionField("目标相册", listOf("" to "未归入相册") + albums.map { it.id to it.name }, album, { album = it }, enabled = !vm.working)
            if (albums.isEmpty()) Hint("还没有相册，可以先在“相册”页创建。")
            else Hint("选择“未归入相册”可将图片移出当前相册。")
        }
    }
}

@Composable fun DeleteImageDialog(vm: MainViewModel, image: HostedImage, admin: Boolean, dismiss: () -> Unit, deleted: () -> Unit) {
    ConfirmDialog(vm, "删除这张图片？", "“${image.name}”将从存储中删除，此操作无法撤销。", dismiss) {
        vm.api.request((if (admin) "/api/admin/images/" else "/api/images/") + image.id, "DELETE")
        deleted()
        vm.api.request("/api/auth/me")
    }
}

@Composable fun BatchMoveDialog(vm: MainViewModel, ids: Set<String>, dismiss: () -> Unit, completed: (ImageBatchResult) -> Unit) {
    val data = resource(vm, "/api/albums")
    var album by remember { mutableStateOf("") }
    FormDialog("移动 ${ids.size} 张图片", { if (!vm.working) dismiss() }, footer = {
        Action("确认移动", Modifier.weight(1f), primary = true, enabled = !vm.working && data.data != null) {
            vm.work { completed(vm.editImages(ids, "PATCH", jsonOf("albumId" to album.ifEmpty { null }))) }
        }
    }) {
        ResourceState(data, vm) { result ->
            val albums = result.getJSONArray("albums").mapObjects(Album::from)
            SelectionField("目标相册", listOf("" to "未归入相册") + albums.map { it.id to it.name }, album, { album = it }, enabled = !vm.working)
        }
    }
}
