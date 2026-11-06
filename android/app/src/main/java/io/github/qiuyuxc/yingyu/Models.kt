package io.github.qiuyuxc.yingyu

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

data class User(val id: String, val name: String, val email: String, val role: String,
    val quota: Long, val used: Long, val reserved: Long, val imageCount: Int, val avatar: String?,
    val tier: String = "免费空间", val avatarLibraryEnabled: Boolean = false,
    val avatarLibraryExpiresAt: String? = null, val avatarHistoryCount: Int = 0) {
    val isAdmin get() = role == "admin"
    companion object {
        fun from(o: JSONObject) = User(o.getString("id"), o.getString("name"), o.getString("email"),
            o.getString("role"), o.getLong("quotaBytes"), o.getLong("usedBytes"),
            o.optLong("reservedBytes"), o.optInt("imageCount"), o.nullableString("avatarUrl"), o.optString("tier", "免费空间"),
            o.optBoolean("avatarLibraryEnabled"), o.nullableString("avatarLibraryExpiresAt"), o.optInt("avatarHistoryCount"))
    }
    fun json() = jsonOf("id" to id, "name" to name, "email" to email, "role" to role,
        "quotaBytes" to quota, "usedBytes" to used, "reservedBytes" to reserved,
        "imageCount" to imageCount, "avatarUrl" to avatar, "tier" to tier, "avatarLibraryEnabled" to avatarLibraryEnabled,
        "avatarLibraryExpiresAt" to avatarLibraryExpiresAt, "avatarHistoryCount" to avatarHistoryCount)
}

data class ClientSession(val baseUrl: String, val token: String, val expiresAt: String, val user: User) {
    fun json() = jsonOf("baseUrl" to baseUrl, "token" to token, "expiresAt" to expiresAt, "user" to user.json())
    companion object {
        fun from(o: JSONObject) = ClientSession(o.getString("baseUrl"), o.getString("token"),
            o.getString("expiresAt"), User.from(o.getJSONObject("user")))
    }
}

data class HostedImage(val id: String, val name: String, val size: Long, val url: String,
    val visibility: String, val starred: Boolean, val albumId: String?, val createdAt: String, val owner: String?, val mime: String = "image/jpeg",
    val width: Int? = null, val height: Int? = null) {
    companion object {
        fun from(o: JSONObject) = HostedImage(o.getString("id"), o.getString("name"), o.getLong("size"),
            o.getString("url"), o.getString("visibility"), o.getBoolean("starred"),
            o.nullableString("albumId"), o.getString("createdAt"), o.nullableString("ownerName"), o.optString("mime", "image/jpeg"),
            if (o.isNull("width")) null else o.optInt("width"), if (o.isNull("height")) null else o.optInt("height"))
    }
    fun link(format: String): String = when (format) {
        "Markdown" -> "![${name.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")}]($url)"
        "HTML" -> "<img src=\"${url.html()}\" alt=\"${name.html()}\" />"
        "BBCode" -> "[img]$url[/img]"
        else -> url
    }
}

data class Album(val id: String, val name: String, val count: Int, val createdAt: String = "", val coverUrl: String? = null) {
    companion object { fun from(o: JSONObject) = Album(o.getString("id"), o.getString("name"), o.getInt("count"), o.optString("createdAt"), o.nullableString("coverUrl")) }
}
data class Announcement(val id: String, val title: String, val content: String, val revision: Int, val publishedAt: String?) {
    companion object { fun from(o: JSONObject) = Announcement(o.getString("id"), o.getString("title"), o.getString("content"), o.optInt("revision", 1), o.nullableString("publishedAt")) }
}
data class QuotaRequest(val id: String, val userName: String, val current: Long, val requested: Long,
    val reason: String, val status: String, val note: String) {
    companion object {
        fun from(o: JSONObject) = QuotaRequest(o.getString("id"), o.optString("userName"), o.getLong("currentQuota"),
            o.getLong("requestedBytes"), o.getString("reason"), o.getString("status"), o.optString("adminNote"))
    }
}

fun JSONObject.nullableString(key: String) = if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }
fun jsonOf(vararg values: Pair<String, Any?>) = JSONObject().apply { values.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) } }
fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> = (0 until length()).map { transform(getJSONObject(it)) }
fun String.html() = replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")
fun bytes(value: Long): String {
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var amount = value.coerceAtLeast(0).toDouble(); var index = 0
    while (amount >= 1024 && index < units.lastIndex) { amount /= 1024; index++ }
    return if (index == 0) "${amount.toLong()} B" else String.format(Locale.ROOT, "%.1f %s", amount, units[index])
}
