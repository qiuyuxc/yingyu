package io.github.qiuyuxc.yingyu

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.utils.overScrollVertical

@Composable fun AlbumsScreen(vm: MainViewModel) {
    val feed = rememberFeed(vm, "/api/albums", "albums", 100, paginated = false)
    val albums = feed.items.map(Album::from)
    val state = rememberLazyListState()
    var creating by remember { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    var menu by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<Album?>(null) }
    var renaming by remember { mutableStateOf<Album?>(null) }
    FeedRefresh(vm, feed, Modifier.fillMaxSize()) {
        LazyColumn(state = state, modifier = Modifier.fillMaxSize().overScrollVertical(), overscrollEffect = null,
            contentPadding = PaddingValues(start = AppSpacing.pagePadding, end = AppSpacing.pagePadding, top = 12.dp, bottom = contentBottomPadding(vm)),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "heading") {
                PageHeader("我的相册", if (feed.ready) "${albums.size} 个相册" else "正在加载…") {
                    IconAction("refresh", "刷新相册") { vm.refresh(feed) }
                    Action("＋ 新建", compact = true, primary = true) { name = ""; creating = true }
                }
            }
            if (feed.error != null) item(key = "error") { FeedProblem(feed) }
            if (feed.ready && !feed.loading && feed.error == null && albums.isEmpty()) item(key = "empty") {
                GlassCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Glyph("albums", Modifier.size(30.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("还没有相册", fontSize = AppType.section, lineHeight = 19.sp)
                            Hint("按旅行、作品或日常分类，方便随时查找。")
                        }
                    }
                }
            }
            items(albums, key = { it.id }) { album ->
                Box(Modifier.animateItem()) {
                    GlassCard(Modifier.fillMaxWidth(), spacing = 0.dp, onClick = { vm.openAlbum(album) }) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Box(Modifier.size(64.dp, 48.dp).clip(RoundedCornerShape(10.dp)).background(LocalColors.current.accent.copy(alpha = .09f)), contentAlignment = Alignment.Center) {
                                if (album.coverUrl != null) Photo(vm, album.coverUrl, album.name, Modifier.fillMaxSize())
                                else Glyph("albums", Modifier.size(26.dp))
                            }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(album.name, fontSize = AppType.section, lineHeight = 19.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Hint("${album.count} 张图片" + if (album.createdAt.isNotEmpty()) " · " + album.createdAt.take(10) else "")
                            }
                            IconAction("more", "相册操作：" + album.name) { menu = album.id }
                        }
                    }
                    if (menu == album.id) MenuPopup({ menu = null }) {
                        MenuOption("查看相册", "albums") { menu = null; vm.openAlbum(album) }
                        MenuOption("重命名", "edit", enabled = !vm.working) { menu = null; name = album.name; renaming = album }
                        MenuOption("删除相册", "trash", danger = true, enabled = !vm.working) { menu = null; deleting = album }
                    }
                }
            }
            item(key = "footer") { FeedFooter(feed, "个相册") }
        }
    }
    if (creating || renaming != null) FormDialog(if (creating) "新建相册" else "重命名相册", { if (!vm.working) { creating = false; renaming = null } }, footer = {
        Action(if (creating) "创建相册" else "保存名称", Modifier.weight(1f), primary = true, enabled = !vm.working && name.isNotBlank() && (creating || name.trim() != renaming?.name)) {
            vm.work("相册已更新") {
                if (creating) vm.api.request("/api/albums", "POST", jsonOf("name" to name.trim()))
                else vm.api.request("/api/albums/${renaming!!.id}", "PATCH", jsonOf("name" to name.trim()))
                creating = false; renaming = null
            }
        }
    }) {
        Field("相册名称", name, { name = it.take(40) }, placeholder = "例如：旅行记录", enabled = !vm.working)
    }
    deleting?.let { album ->
        ConfirmDialog(vm, "删除相册“${album.name}”？", "仅删除相册，其中的图片仍保留在图库。", { deleting = null }) {
            vm.api.request("/api/albums/${album.id}", "DELETE")
        }
    }
}

@Composable fun UploadScreen(vm: MainViewModel) {
    var format by rememberSaveable { mutableStateOf("直链") }
    val albumData = resource(vm, "/api/albums")
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(20)) { vm.addUploads(it) }
    val context = LocalContext.current
    val pick: () -> Unit = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
    val completed = vm.uploads.mapNotNull { it.image }
    val pending = vm.uploads.count { it.status in setOf("queued", "error") }
    Page(vm, "上传图片", actions = {
        if (vm.uploads.isNotEmpty()) Action("＋ 添加", compact = true, enabled = !vm.staging, onClick = pick)
    }) {
        if (vm.uploads.isEmpty()) GlassCard(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(42.dp).clip(RoundedCornerShape(13.dp)).background(LocalColors.current.accent.copy(alpha = .09f)), contentAlignment = Alignment.Center) {
                    Glyph("upload", Modifier.size(26.dp))
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("选择要上传的图片", fontSize = AppType.section, lineHeight = 19.sp)
                    Hint("JPG / PNG / GIF / WebP / AVIF\n单张不超过 ${bytes(vm.maxUploadBytes)}")
                }
            }
            Action(if (vm.staging) "正在读取图片…" else "从系统相册选择", Modifier.fillMaxWidth(), enabled = !vm.staging, primary = true, onClick = pick)
        }
        if (vm.staging && vm.uploads.isNotEmpty()) Hint("正在读取所选图片…")
        GlassCard(Modifier.fillMaxWidth()) {
            Text("上传设置", fontSize = AppType.section, lineHeight = 19.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1.2f)) {
                    ResourceState(albumData, vm) { data ->
                        val albums = data.getJSONArray("albums").mapObjects(Album::from)
                        SelectionField("上传到相册", listOf("" to "不归入相册") + albums.map { it.id to it.name },
                            vm.uploadAlbum ?: "", { vm.uploadAlbum = it.ifEmpty { null } }, enabled = !vm.uploading)
                    }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("可见性", fontSize = AppType.caption, lineHeight = 14.sp, color = LocalColors.current.muted)
                    Choices(listOf("public" to "公开", "private" to "私密"), vm.uploadVisibility, { vm.uploadVisibility = it }, !vm.uploading)
                }
            }
            Hint(if (vm.uploadVisibility == "private") "私密图片仅本人和管理员可查看。" else "公开图片可通过链接分享。")
            LocalSession.current?.user?.let { user ->
                Divider()
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Hint("可用空间 ${bytes(user.quota - user.used - user.reserved)}")
                    Action("申请扩容", compact = true) { vm.navigate("quota") }
                }
            }
        }
        if (vm.uploads.isNotEmpty()) {
            GlassCard(Modifier.fillMaxWidth(), spacing = 0.dp) {
                Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("上传队列 · ${vm.uploads.size}", fontSize = AppType.section, lineHeight = 19.sp)
                        Hint("$pending 张待上传 · ${completed.size} 张已完成")
                    }
                    Action(if (vm.uploading) "上传中…" else if (vm.uploads.none { it.status == "queued" } && pending > 0) "重试失败" else "开始上传",
                        compact = true, enabled = !vm.uploading && !vm.staging && pending > 0 && albumData.data != null, primary = true) { vm.startUploads() }
                }
                Divider()
                vm.uploads.forEachIndexed { index, item ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (item.image != null) Photo(vm, item.image.url, item.name, Modifier.size(42.dp).clip(RoundedCornerShape(10.dp)))
                        else AsyncImage(item.file, imageLoader = LocalImages.current, contentDescription = item.name, contentScale = ContentScale.Crop,
                            modifier = Modifier.size(42.dp).clip(RoundedCornerShape(10.dp)))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(item.name, fontSize = AppType.body, lineHeight = AppType.bodyLine, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(when (item.status) {
                                "uploading" -> if (item.progress == 100) "正在保存…" else "正在上传 ${item.progress}%"
                                "done" -> "上传完成"; "error" -> item.error ?: "上传失败"; else -> "等待上传 · ${bytes(item.file.length())}"
                            }, fontSize = AppType.small, lineHeight = 13.sp,
                                color = if (item.status == "error") androidx.compose.ui.graphics.Color(0xFFCA6262) else LocalColors.current.muted,
                                maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (item.status == "uploading") Box(Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(LocalColors.current.accent.copy(alpha = .12f))) {
                                AppProgress(item.progress / 100f, Modifier.fillMaxWidth(), height = 3.dp)
                            }
                        }
                        item.image?.let { uploaded -> IconAction("copy", "复制链接：" + item.name) { copy(context, uploaded.link(format)); vm.message = "链接已复制" } }
                        if (item.status == "error") IconAction("refresh", "重试：" + item.name, enabled = !vm.uploading && !vm.staging) { vm.startUploads(setOf(item.id)) }
                        if (item.status != "uploading") IconAction("close", "移除：" + item.name, enabled = !vm.uploading) { vm.removeUpload(item) }
                    }
                    if (index != vm.uploads.lastIndex) Divider()
                }
                if (completed.isNotEmpty()) {
                    Divider()
                    Column(Modifier.fillMaxWidth().padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Hint("复制格式")
                        Choices(listOf("直链", "Markdown", "HTML", "BBCode").map { it to it }, format, { format = it })
                    }
                    Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Action("复制全部链接", compact = true) { copy(context, completed.joinToString("\n") { it.link(format) }); vm.message = "链接已复制" }
                        Action("清理已完成", compact = true, enabled = !vm.uploading) { vm.uploads.filter { it.status == "done" }.forEach(vm::removeUpload) }
                    }
                }
            }
            Hint("最多同时上传 3 张。上传期间请保持 App 运行。")
        }
    }
}
