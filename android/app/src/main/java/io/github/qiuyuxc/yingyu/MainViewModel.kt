package io.github.qiuyuxc.yingyu

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.core.content.edit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.time.Instant

data class UploadItem(val id: String, val file: File, val name: String, val mime: String,
    val status: String = "queued", val progress: Int = 0, val error: String? = null, val image: HostedImage? = null)
data class ImageBatchResult(val completed: Set<String>, val failed: Map<String, String>)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    val api = ApiClient(EncryptedSessionStore(application))
    val session = api.session
    private val preferences = application.getSharedPreferences("appearance", 0)
    val lastServer get() = preferences.getString("lastServer", "").orEmpty()
    var theme by mutableStateOf(preferences.getString("theme", "system")!!); private set
    var palette by mutableStateOf(preferences.getString("palette", "mono")?.takeIf { it in setOf("mono", "forest", "blue") } ?: "mono"); private set
    var glass by mutableStateOf(preferences.getBoolean("glass", true)); private set
    var reduceMotion by mutableStateOf(preferences.getBoolean("reduceMotion", false)); private set
    var galleryView by mutableStateOf(preferences.getString("galleryView", "grid")!!); private set
    val navigation = AppNavigation()
    val tab get() = navigation.tab
    val page get() = navigation.page
    val selectedAlbum get() = navigation.album
    var revision by mutableIntStateOf(0)
    var message by mutableStateOf<String?>(null)
    var working by mutableStateOf(false); private set
    var site by mutableStateOf<JSONObject?>(null); private set
    var syncError by mutableStateOf<String?>(null); private set
    var popupNotice by mutableStateOf<Announcement?>(null); private set
    var recentNotices by mutableStateOf<List<Announcement>>(emptyList()); private set
    var noticeLedger by mutableStateOf<NoticeLedger?>(null); private set
    val hasUnreadNotices get() = recentNotices.any { noticeLedger?.isUnread(it) == true }
    private val noticePreferences = application.getSharedPreferences("announcements", 0)
    private val noticeStorage = object : NoticeStorage {
        override fun get(key: String) = noticePreferences.getString(key, null)
        override fun put(key: String, value: String) { noticePreferences.edit { putString(key, value) } }
        override fun entries(prefix: String) = noticePreferences.all.filterKeys { it.startsWith(prefix) }.mapNotNull { (key, value) ->
            (value as? String)?.let { key to it }
        }.toMap()
    }
    private val feeds = linkedMapOf<String, PageFeed>()
    private var syncJob: Job? = null
    private var lastSync = 0L
    var uploads by mutableStateOf<List<UploadItem>>(emptyList()); private set
    var uploading by mutableStateOf(false); private set
    var staging by mutableStateOf(false); private set
    var uploadAlbum by mutableStateOf<String?>(null)
    var uploadVisibility by mutableStateOf("public")
    private var uploadJob: Job? = null
    private var stagingJob: Job? = null
    private var pendingShared = emptyList<Uri>()
    val maxUploadBytes get() = site?.optJSONObject("settings")?.optLong("maxUploadBytes", 20L * 1024 * 1024) ?: 20L * 1024 * 1024

    init {
        val startedAt = System.currentTimeMillis()
        viewModelScope.launch(Dispatchers.IO) {
            File(application.cacheDir, "upload-stage").listFiles()?.filter { it.isFile && it.lastModified() < startedAt }?.forEach { it.delete() }
        }
        viewModelScope.launch {
            session.map { it?.let { value -> value.baseUrl to value.user.id } }.distinctUntilChanged().collectLatest { identity ->
                uploadJob?.cancelAndJoin(); stagingJob?.cancelAndJoin(); syncJob?.cancelAndJoin()
                uploads.forEach { it.file.delete() }; uploads = emptyList()
                feeds.values.forEach(PageFeed::dispose); feeds.clear()
                navigation.reset(); uploadAlbum = null; uploading = false; staging = false
                noticeLedger = null; popupNotice = null; recentNotices = emptyList(); site = null; syncError = null; lastSync = 0
                if (identity != null) {
                    noticeLedger = NoticeLedger(identity.first, identity.second, noticeStorage)
                    syncSite(force = true)
                    syncJob?.join()
                    if (session.value?.let { it.baseUrl to it.user.id } == identity && pendingShared.isNotEmpty()) {
                        val uris = pendingShared; pendingShared = emptyList(); addUploads(uris)
                    }
                }
            }
        }
    }
    fun appearance(newTheme: String = theme, newPalette: String = palette, effects: Boolean = glass) {
        theme = newTheme; palette = newPalette; glass = effects
        preferences.edit { putString("theme", theme); putString("palette", palette); putBoolean("glass", glass) }
    }
    fun rememberServer(base: String) { preferences.edit { putString("lastServer", base) } }
    fun navigate(route: String) = navigation.navigate(route)
    fun selectTab(index: Int) = navigation.selectTab(index)
    fun openAlbum(album: Album) = navigation.openAlbum(album)
    fun goBack() = navigation.back()
    fun motion(reduced: Boolean) { reduceMotion = reduced; preferences.edit { putBoolean("reduceMotion", reduced) } }
    fun galleryLayout(value: String) { galleryView = value; preferences.edit { putString("galleryView", value) } }
    fun feed(path: String, field: String, pageSize: Int, paginated: Boolean = true): PageFeed {
        val key = listOf(path, field, pageSize.toString(), paginated.toString()).joinToString("|")
        feeds.remove(key)?.let { feeds[key] = it; return it }
        val feed = PageFeed(viewModelScope, path, field, pageSize, paginated) { route -> api.request(route) }
        feeds[key] = feed
        while (feeds.size > 12) { val first = feeds.keys.first(); feeds.remove(first)?.dispose() }
        return feed
    }
    fun refresh(feed: PageFeed? = null) { revision++; feed?.ensureLoaded(revision); syncSite(force = true) }
    fun syncSite(force: Boolean = false) {
        val owner = session.value?.let { it.baseUrl to it.user.id } ?: return
        if (syncJob?.isActive == true || (!force && System.currentTimeMillis() - lastSync < 30_000)) return
        lastSync = System.currentTimeMillis()
        syncJob = viewModelScope.launch {
            try {
                api.request("/api/auth/me")
                val nextSite = api.publicRequest(owner.first, "/api/site")
                if (session.value?.let { it.baseUrl to it.user.id } != owner) return@launch
                site = nextSite
                val notices = api.request("/api/announcements?page=1").getJSONArray("announcements").mapObjects(Announcement::from)
                val popup = api.request("/api/announcements/popup").optJSONObject("announcement")?.let(Announcement::from)
                if (session.value?.let { it.baseUrl to it.user.id } != owner) return@launch
                recentNotices = notices; syncError = null
                if (popup != null && noticeLedger?.shouldShowPopup(popup) == true) {
                    noticeLedger?.presented(popup)
                    popupNotice = popup
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (session.value?.let { it.baseUrl to it.user.id } == owner) syncError = e.message ?: "站点信息暂时无法更新" }
        }
    }
    fun closeNotice(notice: Announcement, permanently: Boolean = false) {
        noticeLedger?.closePopup(notice, permanently)
        if (popupNotice?.id == notice.id && popupNotice?.revision == notice.revision) popupNotice = null
    }
    fun popupPreference(enabled: Boolean) {
        noticeLedger?.configurePopups(enabled)
        if (!enabled) popupNotice = null else syncSite(force = true)
    }
    fun markAllNoticesRead() = work("公告已全部标为已读") {
        var page = 1
        var received = 0
        var more = true
        while (more) {
            val response = api.request("/api/announcements?page=" + page)
            val notices = response.getJSONArray("announcements").mapObjects(Announcement::from)
            notices.forEach { noticeLedger?.markRead(it) }
            received += notices.size; page++
            more = notices.isNotEmpty() && received < response.optInt("total", received)
        }
    }
    suspend fun uploadAvatar(uri: Uri) {
        val application = getApplication<Application>()
        val file = File.createTempFile("avatar-", ".upload", application.cacheDir)
        try {
            val resolver = application.contentResolver
            val mime = resolver.getType(uri) ?: "application/octet-stream"
            withContext(Dispatchers.IO) {
                resolver.openInputStream(uri)?.use { input -> file.outputStream().use { output ->
                    val buffer = ByteArray(65536); var total = 0
                    while (true) { val count = input.read(buffer); if (count < 0) break
                        total += count; require(total <= 5 * 1024 * 1024) { "头像不能超过 5 MB" }; output.write(buffer, 0, count)
                    }
                    require(total > 0) { "头像文件为空" }
                } } ?: error("无法读取图片")
            }
            api.upload(file, "avatar", mime, null, "private", {}, "/api/account/avatars")
        } finally { file.delete() }
    }
    suspend fun editImages(ids: Set<String>, method: String, body: JSONObject? = null, admin: Boolean = false): ImageBatchResult = coroutineScope {
        require(!admin || method == "DELETE")
        val semaphore = Semaphore(3)
        val results = ids.map { id -> async { semaphore.withPermit {
            try { api.request((if (admin) "/api/admin/images/" else "/api/images/") + id, method, body); id to null }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { id to (e.message ?: "操作失败") }
        } } }.awaitAll()
        val completed = results.filter { it.second == null }.map { it.first }.toSet()
        if (method == "DELETE" && completed.isNotEmpty()) {
            try { api.request("/api/auth/me") } catch (e: CancellationException) { throw e } catch (_: Exception) { syncSite(force = true) }
        }
        ImageBatchResult(completed, results.mapNotNull { (id, error) -> error?.let { id to it } }.toMap())
    }
    fun notify(error: Exception) { message = error.message ?: "操作未完成，请重试" }
    fun work(success: String? = null, block: suspend () -> Unit) {
        if (working) return
        working = true
        viewModelScope.launch {
            try { block(); if (success != null) message = success }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { notify(e) }
            finally { revision++; working = false }
        }
    }
    fun signOut() = work {
        uploadJob?.cancelAndJoin(); stagingJob?.cancelAndJoin()
        try { api.logout() } catch (e: Exception) { message = "已在本机退出；网络异常，服务器会话将在到期后失效" }
    }
    fun receiveShared(uris: List<Uri>) {
        if (session.value == null) { pendingShared = uris.take(20); message = "登录后即可上传分享的图片" }
        else addUploads(uris)
    }
    fun addUploads(uris: List<Uri>) {
        if (staging || uris.isEmpty()) return
        val owner = session.value?.let { it.baseUrl to it.user.id } ?: return
        selectTab(2); staging = true
        stagingJob = viewModelScope.launch {
            try {
                if (site == null) { syncSite(force = true); syncJob?.join() }
                if (session.value?.let { it.baseUrl to it.user.id } != owner) return@launch
                val available = (60 - uploads.size).coerceAtLeast(0)
                if (available == 0) { message = "队列最多保留 60 张图片，请先清理已完成项目"; return@launch }
                for (uri in uris.distinct().take(available)) {
                    var staged: File? = null
                    try {
                        val item = withContext(Dispatchers.IO) {
                            require(uri.scheme == "content") { "请选择系统相册中的图片" }
                            val resolver = getApplication<Application>().contentResolver
                            val mime = resolver.getType(uri) ?: "application/octet-stream"
                            require(mime in setOf("image/jpeg", "image/png", "image/gif", "image/webp", "image/avif")) { "支持 JPG、PNG、GIF、WebP 和 AVIF 图片" }
                            var name = "image-${UUID.randomUUID()}"
                            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                                if (cursor.moveToFirst()) {
                                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                                    if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) require(cursor.getLong(sizeIndex) <= maxUploadBytes) { "${name} 超过 ${bytes(maxUploadBytes)}" }
                                }
                            }
                            val directory = File(getApplication<Application>().cacheDir, "upload-stage").apply { mkdirs() }
                            val file = File.createTempFile("image-", ".upload", directory); staged = file
                            resolver.openInputStream(uri)?.use { input -> file.outputStream().use { output ->
                                val buffer = ByteArray(65536); var total = 0L
                                while (true) {
                                    val count = input.read(buffer); if (count < 0) break
                                    total += count; require(total <= maxUploadBytes) { "${name} 超过 ${bytes(maxUploadBytes)}" }
                                    output.write(buffer, 0, count)
                                }
                                require(total > 0) { "图片文件为空" }
                            } } ?: error("无法读取图片，请重新选择")
                            UploadItem(UUID.randomUUID().toString(), file, name.substringAfterLast('/').take(200), mime)
                        }
                        if (session.value?.let { it.baseUrl to it.user.id } != owner) break
                        uploads = uploads + item; staged = null
                    } catch (e: CancellationException) { throw e } catch (e: Exception) { notify(e) }
                    finally { staged?.delete() }
                }
            } finally { staging = false }
        }
    }
    private fun updateUpload(id: String, transform: (UploadItem) -> UploadItem) {
        uploads = uploads.map { if (it.id == id) transform(it) else it }
    }
    fun startUploads(ids: Set<String>? = null) {
        if (uploading || staging) return
        val pending = uploads.filter { it.status in setOf("queued", "error") && (ids == null || it.id in ids) }
        if (pending.isEmpty()) return
        uploading = true
        val album = uploadAlbum; val visibility = uploadVisibility
        uploadJob = viewModelScope.launch {
            try {
                val semaphore = Semaphore(3)
                pending.map { item -> async {
                    semaphore.withPermit {
                        updateUpload(item.id) { it.copy(status = "uploading", progress = 0, error = null) }
                        try {
                            val result = api.upload(item.file, item.name, item.mime, album, visibility, { value ->
                                viewModelScope.launch { updateUpload(item.id) { it.copy(progress = value) } }
                            })
                            val image = HostedImage.from(result.getJSONObject("image"))
                            updateUpload(item.id) { it.copy(status = "done", progress = 100, image = image) }
                            item.file.delete()
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { updateUpload(item.id) { it.copy(status = "error", error = e.message ?: "上传失败") } }
                    }
                } }.awaitAll()
                revision++
                api.request("/api/auth/me")
            } catch (e: CancellationException) { throw e } catch (e: Exception) { notify(e) }
            finally { uploading = false }
        }
    }
    fun removeUpload(item: UploadItem) {
        if (uploading) return
        item.file.delete(); uploads = uploads.filterNot { it.id == item.id }
    }
}
