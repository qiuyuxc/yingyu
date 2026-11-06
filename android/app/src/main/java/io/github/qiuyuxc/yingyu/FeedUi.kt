package io.github.qiuyuxc.yingyu

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.distinctUntilChanged
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.PullToRefresh
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable fun rememberFeed(vm: MainViewModel, path: String, field: String, pageSize: Int = 40, paginated: Boolean = true): PageFeed {
    val feed = remember(vm, path, field, pageSize, paginated) { vm.feed(path, field, pageSize, paginated) }
    LaunchedEffect(feed, vm.revision) { feed.ensureLoaded(vm.revision) }
    return feed
}

@Composable fun LoadMoreOnScroll(state: LazyGridState, feed: PageFeed) {
    LaunchedEffect(state, feed) {
        snapshotFlow {
            val info = state.layoutInfo
            Triple(info.visibleItemsInfo.lastOrNull()?.index ?: -1, info.totalItemsCount,
                feed.canLoadMore && info.totalItemsCount >= feed.items.size + 2)
        }.distinctUntilChanged().collect { (last, count, available) ->
            if (available && count > 0 && last >= count - 8) feed.loadMore()
        }
    }
}

@Composable fun LoadMoreOnScroll(state: LazyListState, feed: PageFeed) {
    LaunchedEffect(state, feed) {
        snapshotFlow {
            val info = state.layoutInfo
            Triple(info.visibleItemsInfo.lastOrNull()?.index ?: -1, info.totalItemsCount,
                feed.canLoadMore && info.totalItemsCount >= feed.items.size + 2)
        }.distinctUntilChanged().collect { (last, count, available) ->
            if (available && count > 0 && last >= count - 5) feed.loadMore()
        }
    }
}

@Composable fun FeedRefresh(vm: MainViewModel, feed: PageFeed, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    PullToRefresh(isRefreshing = feed.refreshing, onRefresh = { vm.refresh(feed) }, modifier = modifier,
        color = LocalColors.current.accent, circleSize = 20.dp,
        refreshTexts = listOf("下拉刷新", "松开刷新", "正在刷新", "刷新完成"),
        refreshTextStyle = MiuixTheme.textStyles.footnote1, content = content)
}

@Composable fun FeedProblem(feed: PageFeed) {
    if (feed.error != null) GlassCard(Modifier.fillMaxWidth()) {
        Text(feed.error.orEmpty(), fontSize = AppType.caption, lineHeight = AppType.captionLine)
        Action("重试", compact = true, onClick = feed::retry)
    }
}

@Composable fun FeedFooter(feed: PageFeed, noun: String) {
    when {
        feed.loading || !feed.ready || feed.loadingMore -> Row(Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp))
            Hint(if (feed.loadingMore) "正在加载更多…" else "正在加载…")
        }
        feed.moreError != null -> Column(Modifier.fillMaxWidth().padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Hint(feed.moreError.orEmpty())
            Action("点击继续加载", compact = true, onClick = feed::retry)
        }
        feed.items.isNotEmpty() && !feed.hasMore -> Box(Modifier.fillMaxWidth().padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
            Hint("已显示 " + feed.items.size + " " + noun)
        }
    }
}
