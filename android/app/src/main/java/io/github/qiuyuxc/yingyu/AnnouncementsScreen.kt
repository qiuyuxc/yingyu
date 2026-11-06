package io.github.qiuyuxc.yingyu

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.utils.overScrollVertical

@Composable fun AppAnnouncements(vm: MainViewModel) {
    vm.popupNotice?.let { notice ->
        key(notice.id, notice.revision) {
            AnnouncementDialog(notice, { vm.closeNotice(notice) }, { vm.closeNotice(notice, permanently = true) })
        }
    }
}

@Composable fun AnnouncementDialog(notice: Announcement, dismiss: () -> Unit, permanently: (() -> Unit)? = null) {
    FormDialog(notice.title, dismiss, footer = {
        if (permanently != null) Action("不再弹出", compact = true, onClick = permanently)
        Action("我知道了", Modifier.weight(1f), primary = true, onClick = dismiss)
    }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Glyph("notice", Modifier.size(16.dp))
            Hint("站点公告" + (notice.publishedAt?.let { " · " + it.take(10) } ?: ""))
        }
        SelectionContainer { Text(notice.content, fontSize = AppType.body, lineHeight = AppType.bodyLine) }
    }
}

@Composable fun AnnouncementsScreen(vm: MainViewModel) {
    val feed = rememberFeed(vm, "/api/announcements", "announcements", 20)
    val notices = feed.items.map(Announcement::from)
    val state = rememberLazyListState()
    var opened by remember { mutableStateOf<Announcement?>(null) }
    LoadMoreOnScroll(state, feed)
    FeedRefresh(vm, feed, Modifier.fillMaxSize()) {
        LazyColumn(state = state, modifier = Modifier.fillMaxSize().overScrollVertical(), overscrollEffect = null,
            contentPadding = PaddingValues(start = AppSpacing.pagePadding, end = AppSpacing.pagePadding, top = 12.dp, bottom = contentBottomPadding(vm)),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item(key = "heading") {
                PageHeader("公告中心", if (feed.ready) "${feed.total} 条公告" else "正在加载…", onBack = { vm.goBack() }) {
                    IconAction("refresh", "刷新公告") { vm.refresh(feed) }
                    IconAction("check", "全部标为已读", enabled = !vm.working && notices.isNotEmpty()) { vm.markAllNoticesRead() }
                }
            }
            if (feed.error != null) item(key = "error") { FeedProblem(feed) }
            if (feed.ready && !feed.loading && feed.error == null && notices.isEmpty()) item(key = "empty") {
                GlassCard(Modifier.fillMaxWidth()) { Text("暂无公告", fontSize = AppType.section); Hint("站点发布的通知会出现在这里。") }
            }
            items(notices, key = { it.id }) { notice ->
                GlassCard(Modifier.animateItem().fillMaxWidth(), onClick = { vm.noticeLedger?.markRead(notice); opened = notice }) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(notice.title, modifier = Modifier.weight(1f), fontSize = AppType.section, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (vm.noticeLedger?.isUnread(notice) != false) Text("新", fontSize = AppType.small, color = LocalColors.current.accent)
                        Glyph("next", Modifier.size(13.dp), LocalColors.current.muted)
                    }
                    notice.publishedAt?.let { Hint(it.take(10)) }
                    Text(notice.content, fontSize = AppType.body, lineHeight = AppType.bodyLine, color = LocalColors.current.muted,
                        maxLines = 3, overflow = TextOverflow.Ellipsis)
                }
            }
            item(key = "footer") { FeedFooter(feed, "条公告") }
        }
    }
    opened?.let { notice -> AnnouncementDialog(notice, { opened = null }) }
}

@Composable fun GalleryNotices(vm: MainViewModel) {
    val ledger = vm.noticeLedger
    val message = vm.site?.optJSONObject("settings")?.optString("announcement").orEmpty().trim()
    var opened by remember { mutableStateOf(false) }
    val duration = if (LocalMotionEnabled.current) 180 else 0
    AnimatedVisibility(ledger?.bannerVisible(message) == true,
        enter = expandVertically(tween(duration)) + fadeIn(tween(duration)), exit = shrinkVertically(tween(duration)) + fadeOut(tween(duration))) {
        NoticeBanner(message, { opened = true }, { ledger?.dismissBanner(message) })
    }
    val user = LocalSession.current?.user
    val expiry = user?.avatarLibraryExpiresAt
    val now = rememberNow(60_000)
    val remaining = remainingSeconds(expiry, now)
    val expiresSoon = user != null && !user.avatarLibraryEnabled && user.avatarHistoryCount > 0 && expiry != null &&
        remaining <= 3 * 86400 && ledger?.expiryVisible(expiry) != false
    AnimatedVisibility(expiresSoon, enter = expandVertically(tween(duration)) + fadeIn(tween(duration)),
        exit = shrinkVertically(tween(duration)) + fadeOut(tween(duration))) {
        val text = if (remaining > 0) "历史头像将在 ${(remaining + 86399) / 86400} 天内清理，点击管理"
            else "历史头像已到期，正在清理并归还空间"
        NoticeBanner(text, { vm.navigate("avatar-history") }, { if (expiry != null) ledger?.dismissExpiry(expiry) })
    }
    if (opened) FormDialog("站点公告", { opened = false }, footer = {
        Action("我知道了", Modifier.weight(1f), primary = true) { opened = false }
    }) { SelectionContainer { Text(message, fontSize = AppType.body, lineHeight = AppType.bodyLine) } }
}

@Composable private fun NoticeBanner(text: String, open: () -> Unit, dismiss: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(LocalColors.current.accent.copy(alpha = .08f))
        .padding(start = 10.dp, end = 4.dp, top = 5.dp, bottom = 5.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Glyph("notice", Modifier.size(16.dp))
        Text(text, modifier = Modifier.weight(1f).clickable(onClick = open), fontSize = AppType.caption, lineHeight = AppType.captionLine,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
        IconAction("close", "关闭公告", onClick = dismiss)
    }
}
