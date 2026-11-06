package io.github.qiuyuxc.yingyu

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.snapshots.Snapshot
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

class PageFeedTest {
    private fun response(ids: List<String>, total: Int, field: String = "images") =
        jsonOf(field to JSONArray(ids.map { jsonOf("id" to it) }), "total" to total)
    private fun scope() = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private fun ids(feed: PageFeed) = feed.items.map { it.getString("id") }

    @Test fun anEmptyFirstLoadNotifiesTheScreenThatItCanShowItsEmptyState() {
        val scope = scope()
        try {
            val feed = PageFeed(scope, "/api/images", "images", 2) { response(emptyList(), 0) }
            val readiness = mutableListOf<Boolean>()
            scope.launch { snapshotFlow { feed.ready }.collect { readiness += it } }
            feed.ensureLoaded(0)
            Snapshot.sendApplyNotifications()
            assertEquals(listOf(false, true), readiness)
            assertTrue(feed.ready)
            assertFalse(feed.loading)
        } finally { scope.cancel() }
    }

    @Test fun consecutiveLoadsAppendAndDeduplicateChangingBoundaries() {
        val scope = scope()
        try {
            val calls = mutableListOf<String>()
            val feed = PageFeed(scope, "/api/images?sort=newest", "images", 2) { path ->
                calls += path
                if ("page=1" in path) response(listOf("a", "b"), 4) else response(listOf("b", "c"), 4)
            }
            feed.ensureLoaded(0)
            feed.loadMore()
            assertEquals(listOf("a", "b", "c"), ids(feed))
            assertEquals(listOf("/api/images?sort=newest&page=1&limit=2", "/api/images?sort=newest&page=2&limit=2"), calls)
            assertFalse(feed.hasMore)
            feed.loadMore()
            assertEquals(2, calls.size)
        } finally { scope.cancel() }
    }
    @Test fun aFailedContinuationKeepsItemsAndRetriesTheSameRequest() {
        val scope = scope()
        try {
            var attempts = 0
            val calls = mutableListOf<String>()
            val feed = PageFeed(scope, "/api/images", "images", 2) { path ->
                calls += path
                if ("page=1" in path) response(listOf("a", "b"), 3)
                else if (attempts++ == 0) throw IOException("offline") else response(listOf("c"), 3)
            }
            feed.ensureLoaded(0); feed.loadMore()
            assertEquals(listOf("a", "b"), ids(feed))
            assertEquals("offline", feed.moreError)
            feed.loadMore()
            assertEquals(2, calls.size)
            feed.retry()
            assertEquals(listOf("a", "b", "c"), ids(feed))
            assertEquals(calls[1], calls[2])
            assertNull(feed.moreError)
        } finally { scope.cancel() }
    }
    @Test fun refreshKeepsTheDisplayedStreamUntilTheNewResponseArrives() {
        val scope = scope()
        try {
            val pending = CompletableDeferred<JSONObject>()
            var requests = 0
            val feed = PageFeed(scope, "/api/images", "images", 2) {
                if (requests++ == 0) response(listOf("a", "b"), 3) else pending.await()
            }
            feed.ensureLoaded(0); feed.refresh()
            assertTrue(feed.refreshing)
            assertEquals(listOf("a", "b"), ids(feed))
            feed.loadMore()
            assertEquals(2, requests)
            pending.complete(response(listOf("new"), 1))
            assertEquals(listOf("new"), ids(feed))
            assertFalse(feed.refreshing)
            assertFalse(feed.hasMore)
        } finally { scope.cancel() }
    }
    @Test fun lateResponsesFromCancelledRefreshesCannotReplaceTheCurrentStream() {
        val scope = scope()
        try {
            var previous: Continuation<JSONObject>? = null
            var requests = 0
            val feed = PageFeed(scope, "/api/images", "images", 2) {
                if (requests++ == 0) suspendCoroutine { previous = it } else response(listOf("current"), 1)
            }
            feed.ensureLoaded(0); feed.refresh()
            previous!!.resume(response(listOf("stale"), 1))
            assertEquals(listOf("current"), ids(feed))
            assertFalse(feed.loading)
        } finally { scope.cancel() }
    }
    @Test fun disposalCancelsWorkAndPreventsAccountDataFromReappearing() {
        val scope = scope()
        try {
            val pending = CompletableDeferred<JSONObject>()
            var requests = 0
            val feed = PageFeed(scope, "/api/images", "images", 2) { requests++; pending.await() }
            feed.ensureLoaded(0); feed.dispose()
            pending.complete(response(listOf("old-account"), 1))
            feed.ensureLoaded(1); feed.refresh()
            assertTrue(feed.items.isEmpty())
            assertFalse(feed.loading)
            assertEquals(1, requests)
        } finally { scope.cancel() }
    }
    @Test fun returningToAnUnchangedTabKeepsAllLoadedContentWithoutRefetching() {
        val scope = scope()
        try {
            var requests = 0
            val feed = PageFeed(scope, "/api/images", "images", 2) { path ->
                requests++
                if ("page=1" in path) response(listOf("a", "b"), 4) else response(listOf("c", "d"), 4)
            }
            feed.ensureLoaded(0); feed.loadMore(); feed.ensureLoaded(0)
            assertEquals(listOf("a", "b", "c", "d"), ids(feed))
            assertEquals(2, requests)
        } finally { scope.cancel() }
    }
    @Test fun refreshingAfterAnEditRetainsTheAlreadyLoadedDepth() {
        val scope = scope()
        try {
            var updated = false
            val feed = PageFeed(scope, "/api/images", "images", 2) { path ->
                val ids = if ("page=1" in path) listOf("a", "b") else listOf("c", "d")
                response(ids.map { if (updated) "updated-" + it else it }, 4)
            }
            feed.ensureLoaded(0); feed.loadMore()
            updated = true
            feed.ensureLoaded(1)
            assertEquals(listOf("updated-a", "updated-b", "updated-c", "updated-d"), ids(feed))
        } finally { scope.cancel() }
    }
    @Test fun albumCollectionsUseOneLoadAndScrollAsACompleteList() {
        val scope = scope()
        try {
            val calls = mutableListOf<String>()
            val feed = PageFeed(scope, "/api/albums", "albums", 100, paginated = false) { path ->
                calls += path; response((1..100).map(Int::toString), 100, "albums")
            }
            feed.ensureLoaded(0); feed.loadMore()
            assertEquals(100, feed.items.size)
            assertFalse(feed.hasMore)
            assertEquals(listOf("/api/albums"), calls)
        } finally { scope.cancel() }
    }
}
