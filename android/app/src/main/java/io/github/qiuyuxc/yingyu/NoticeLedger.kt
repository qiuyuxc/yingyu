package io.github.qiuyuxc.yingyu

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.security.MessageDigest

interface NoticeStorage {
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun entries(prefix: String): Map<String, String>
}

internal fun noticeNamespace(baseUrl: String, userId: String): String =
    MessageDigest.getInstance("SHA-256").digest((baseUrl + "\n" + userId).toByteArray())
        .joinToString("") { "%02x".format(it) }

class NoticeLedger(baseUrl: String, userId: String, private val storage: NoticeStorage) {
    private val prefix = noticeNamespace(baseUrl, userId) + ":"
    private val seenThisSession = mutableSetOf<String>()
    var readRevisions by mutableStateOf(storage.entries(prefix + "read:").mapNotNull { (key, value) ->
        value.toIntOrNull()?.let { key.removePrefix(prefix + "read:") to it }
    }.toMap()); private set
    var popupsEnabled by mutableStateOf(storage.get(prefix + "popups") != "false"); private set
    private var bannerDismissed by mutableStateOf(storage.get(prefix + "banner"))
    private var expiryDismissed by mutableStateOf(storage.get(prefix + "expiry"))

    fun isUnread(notice: Announcement) = (readRevisions[notice.id] ?: 0) < notice.revision
    fun markRead(notice: Announcement) {
        val revision = maxOf(readRevisions[notice.id] ?: 0, notice.revision)
        readRevisions = readRevisions + (notice.id to revision)
        storage.put(prefix + "read:" + notice.id, revision.toString())
    }
    fun shouldShowPopup(notice: Announcement) = popupsEnabled &&
        storage.get(prefix + "popup:" + notice.id)?.toIntOrNull() != notice.revision &&
        notice.id + ":" + notice.revision !in seenThisSession

    fun presented(notice: Announcement) { seenThisSession += notice.id + ":" + notice.revision }
    fun closePopup(notice: Announcement, permanently: Boolean) {
        presented(notice)
        markRead(notice)
        if (permanently) storage.put(prefix + "popup:" + notice.id, notice.revision.toString())
    }
    fun configurePopups(value: Boolean) {
        popupsEnabled = value
        storage.put(prefix + "popups", value.toString())
    }
    fun bannerVisible(message: String) = message.isNotBlank() && bannerDismissed != message
    fun dismissBanner(message: String) {
        bannerDismissed = message
        storage.put(prefix + "banner", message)
    }
    fun expiryVisible(expiresAt: String) = expiryDismissed != expiresAt
    fun dismissExpiry(expiresAt: String) {
        expiryDismissed = expiresAt
        storage.put(prefix + "expiry", expiresAt)
    }
}
