package io.github.qiuyuxc.yingyu

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Retains the loaded stream while the user moves between tabs or rotates. */
class PageFeed(
    private val scope: CoroutineScope,
    private val path: String,
    private val field: String,
    private val pageSize: Int,
    private val paginated: Boolean = true,
    private val request: suspend (String) -> JSONObject,
) {
    var items by mutableStateOf<List<JSONObject>>(emptyList()); private set
    var total by mutableIntStateOf(0); private set
    var loading by mutableStateOf(false); private set
    var refreshing by mutableStateOf(false); private set
    var loadingMore by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var moreError by mutableStateOf<String?>(null); private set
    var hasMore by mutableStateOf(false); private set
    private var initialized by mutableStateOf(false)
    private var revision = -1
    private var nextPage = 1
    private var generation = 0
    private var disposed = false
    private var job: Job? = null
    val ready get() = initialized
    val canLoadMore get() = initialized && hasMore && !loading && !refreshing && !loadingMore && error == null && moreError == null

    fun ensureLoaded(value: Int) {
        if (!disposed && (!initialized || revision != value)) {
            revision = value
            refresh()
        }
    }
    fun refresh() {
        if (disposed) return
        val depth = if (paginated) (nextPage - 1).coerceAtLeast(1) else 1
        generation++
        job?.cancel()
        error = null; moreError = null; hasMore = false
        loadingMore = false
        loading = items.isEmpty()
        refreshing = items.isNotEmpty()
        requestPage(1, generation, depth)
    }
    fun loadMore() {
        if (!canLoadMore || disposed) return
        loadingMore = true
        requestPage(nextPage, generation)
    }
    fun retry() {
        if (disposed || loading || refreshing || loadingMore) return
        if (moreError != null) {
            moreError = null
            loadingMore = true
            requestPage(nextPage, generation)
        } else refresh()
    }
    private fun requestPage(first: Int, version: Int, last: Int = first) {
        job = scope.launch {
            try {
                val merged = linkedMapOf<String, JSONObject>()
                if (first > 1) items.forEach { merged[it.getString("id")] = it }
                var loaded = first
                var count = total
                var more = false
                for (page in first..last) {
                    val query = if (paginated) path + (if ('?' in path) "&" else "?") + "page=" + page + "&limit=" + pageSize else path
                    val response = request(query)
                    val rows = response.getJSONArray(field).mapObjects { it }
                    if (disposed || version != generation) return@launch
                    rows.forEach { merged[it.getString("id")] = it }
                    count = response.optInt("total", if (paginated) merged.size else rows.size)
                    loaded = page
                    more = paginated && rows.size >= pageSize && page * pageSize < count
                    if (!more) break
                }
                // Swap the refreshed range together so editing a deep item
                // doesn't discard the rest of the already loaded stream.
                items = merged.values.toList()
                total = count
                nextPage = loaded + 1
                hasMore = more
                error = null; moreError = null
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (!disposed && version == generation) {
                    if (first == 1) error = e.message ?: "加载失败，请重试"
                    else moreError = e.message ?: "后续内容加载失败，请重试"
                }
            } finally {
                if (!disposed && version == generation) {
                    initialized = true
                    loading = false; refreshing = false; loadingMore = false
                }
            }
        }
    }
    fun dispose() {
        disposed = true
        generation++
        job?.cancel()
        loading = false; refreshing = false; loadingMore = false
    }
}
