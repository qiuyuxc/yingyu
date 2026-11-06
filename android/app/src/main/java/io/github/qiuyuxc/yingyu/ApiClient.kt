package io.github.qiuyuxc.yingyu

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(val status: Int, val payload: JSONObject) : IOException(payload.optString("error", "请求失败，请稍后重试"))

internal fun localHttpHost(host: String): Boolean {
    if (host == "localhost" || host == "::1") return true
    val parts = host.split('.').map { it.toIntOrNull() ?: return false }
    if (parts.size != 4 || parts.any { it !in 0..255 }) return false
    return parts[0] == 127 || parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) ||
        (parts[0] == 172 && parts[1] in 16..31)
}
internal fun allowedConnection(url: HttpUrl, allowLocalHttp: Boolean = false) =
    url.isHttps || (allowLocalHttp && url.scheme == "http" && localHttpHost(url.host))

fun canonicalServer(input: String, allowLocalHttp: Boolean = false): String {
    val url = input.trim().toHttpUrl()
    require(allowedConnection(url, allowLocalHttp)) { if (allowLocalHttp) "请填写 HTTPS 站点地址或本地 HTTP 测试地址" else "请填写 HTTPS 站点地址，例如 https://images.example.com" }
    require(url.username.isEmpty() && url.password.isEmpty() && url.encodedPath == "/" && url.query == null && url.fragment == null) {
        "请填写站点根地址，不要包含账号、页面路径或参数"
    }
    return url.toString().trimEnd('/')
}
fun sameOrigin(first: HttpUrl, second: HttpUrl) = first.scheme == second.scheme && first.host == second.host && first.port == second.port

class ApiClient(private val store: SessionStore, val http: OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false)
    .connectTimeout(20, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS)
    .writeTimeout(180, TimeUnit.SECONDS).callTimeout(240, TimeUnit.SECONDS).build()) {
    private val mutableSession = MutableStateFlow(store.load())
    val session = mutableSession.asStateFlow()
    private val renewal = Mutex()
    val imageHttp = http.newBuilder().followRedirects(true).addInterceptor { chain ->
        val current = session.value
        val builder = chain.request().newBuilder().removeHeader("Authorization")
        if (current != null && sameOrigin(chain.request().url, current.baseUrl.toHttpUrl())) {
            builder.header("Authorization", "Bearer ${current.token}")
        }
        chain.proceed(builder.build())
    }.authenticator { _, response ->
        val current = session.value
        if (current != null && response.priorResponse == null && sameOrigin(response.request.url, current.baseUrl.toHttpUrl()) &&
            response.request.header("Authorization") != "Bearer ${current.token}") {
            response.request.newBuilder().header("Authorization", "Bearer ${current.token}").build()
        } else null
    }.build()

    private fun persist(value: ClientSession?) { store.save(value); mutableSession.value = value }
    fun clear() = persist(null)
    private fun accept(base: String, result: JSONObject, fallback: User? = null) {
        if (!result.has("user") && !result.has("session")) return
        val user = result.optJSONObject("user")?.let(User::from) ?: fallback ?: return
        val credentials = result.optJSONObject("session")
        if (credentials != null) persist(ClientSession(base, credentials.getString("accessToken"), credentials.getString("expiresAt"), user))
        else session.value?.takeIf { it.baseUrl == base && it.user.id == user.id }?.let { persist(it.copy(user = user)) }
    }
    suspend fun publicRequest(base: String, path: String, body: JSONObject? = null): JSONObject = execute(base, path, if (body == null) "GET" else "POST", body?.toBody(), null)
    suspend fun signIn(base: String, action: String, body: JSONObject): JSONObject {
        val result = publicRequest(base, "/api/mobile/v1/auth/$action", body)
        accept(base, result)
        return result
    }
    private suspend fun renewIfNeeded() = renewal.withLock {
        val current = session.value ?: throw IOException("请先登录")
        if (Instant.parse(current.expiresAt).isBefore(Instant.now().plusSeconds(86400))) {
            val result = execute(current.baseUrl, "/api/mobile/v1/auth/refresh", "POST", jsonOf().toBody(), current.token)
            if (session.value == current) accept(current.baseUrl, result, current.user)
        }
    }
    suspend fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        try { renewIfNeeded() } catch (e: ApiException) { if (e.status == 401) clear(); throw e }
        val current = session.value ?: throw IOException("请先登录")
        try {
            val result = execute(current.baseUrl, path, method, body?.toBody(), current.token)
            if (session.value?.user?.id != current.user.id || session.value?.baseUrl != current.baseUrl) throw IOException("登录账号已变更")
            accept(current.baseUrl, result, current.user)
            return result
        } catch (e: ApiException) { if (e.status == 401 && session.value?.token == current.token) clear(); throw e }
    }
    suspend fun logout() {
        val current = session.value ?: return
        try { execute(current.baseUrl, "/api/mobile/v1/auth/logout", "POST", jsonOf().toBody(), current.token) }
        finally { clear() }
    }
    suspend fun download(url: String, output: OutputStream) = withContext(Dispatchers.IO) {
        require(allowedConnection(url.toHttpUrl(), BuildConfig.DEBUG)) { "仅支持 HTTPS 或本地测试图片地址" }
        imageHttp.newCall(Request.Builder().url(url).build()).await().use { response ->
            if (!response.isSuccessful) throw IOException("图片保存失败（${response.code}）")
            val body = response.body ?: throw IOException("图片内容为空")
            body.byteStream().use { input -> input.copyTo(output) }
        }
    }
    suspend fun upload(file: File, name: String, mime: String, album: String?, visibility: String, progress: (Int) -> Unit, path: String = "/api/images"): JSONObject {
        renewIfNeeded()
        val current = session.value ?: throw IOException("请先登录")
        val content = object : RequestBody() {
            override fun contentType() = mime.toMediaType()
            override fun contentLength() = file.length()
            override fun writeTo(sink: BufferedSink) {
                file.inputStream().use { input ->
                    val buffer = ByteArray(65536); var written = 0L; var last = -1
                    while (true) {
                        val count = input.read(buffer); if (count < 0) break
                        sink.write(buffer, 0, count); written += count
                        val value = (written * 100 / file.length().coerceAtLeast(1)).toInt()
                        if (value != last) { progress(value); last = value }
                    }
                }
            }
        }
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("file", name, content)
            .addFormDataPart("visibility", visibility).apply { if (album != null) addFormDataPart("albumId", album) }.build()
        val result = execute(current.baseUrl, path, "POST", body, current.token)
        if (session.value?.user?.id != current.user.id) throw IOException("登录账号已变更")
        accept(current.baseUrl, result, current.user)
        return result
    }
    private suspend fun execute(base: String, path: String, method: String, body: RequestBody?, token: String?): JSONObject = withContext(Dispatchers.IO) {
        require(path.startsWith('/') && !path.startsWith("//"))
        val request = Request.Builder().url(base + path).header("Accept", "application/json")
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .method(method, body ?: if (method in listOf("POST", "PUT", "PATCH")) ByteArray(0).toRequestBody() else null).build()
        http.newCall(request).await().use { response ->
            val raw = response.body?.string().orEmpty()
            val result = try { JSONObject(raw) } catch (_: Exception) { throw IOException("站点未返回有效数据，请检查地址和服务版本") }
            if (!response.isSuccessful) throw ApiException(response.code, result)
            result
        }
    }
}
private fun JSONObject.toBody() = toString().toRequestBody("application/json; charset=utf-8".toMediaType())
private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (!continuation.isCancelled) continuation.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) {
            continuation.resume(response, onCancellation = { _, value, _ -> value.close() })
        }
    })
}
