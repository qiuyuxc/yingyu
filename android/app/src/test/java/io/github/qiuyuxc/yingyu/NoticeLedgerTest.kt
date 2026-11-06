package io.github.qiuyuxc.yingyu

import org.junit.Assert.*
import org.junit.Test

private class TestNoticeStorage : NoticeStorage {
    private val values = mutableMapOf<String, String>()
    override fun get(key: String) = values[key]
    override fun put(key: String, value: String) { values[key] = value }
    override fun entries(prefix: String) = values.filterKeys { it.startsWith(prefix) }
}

class NoticeLedgerTest {
    private val notice = Announcement("welcome", "欢迎", "公告正文", 1, null)
    @Test fun permanentPopupDismissalPersistsAndNewRevisionsRemindAgain() {
        val store = TestNoticeStorage()
        val ledger = NoticeLedger("https://one.test", "a", store)
        assertTrue(ledger.shouldShowPopup(notice))
        ledger.closePopup(notice, permanently = true)
        val reopened = NoticeLedger("https://one.test", "a", store)
        assertFalse(reopened.shouldShowPopup(notice))
        assertTrue(reopened.shouldShowPopup(notice.copy(revision = 2)))
    }
    @Test fun ordinaryDismissalLastsForThisSessionAndMarksTheNoticeRead() {
        val store = TestNoticeStorage()
        val ledger = NoticeLedger("https://one.test", "a", store)
        ledger.presented(notice)
        assertFalse(ledger.shouldShowPopup(notice))
        ledger.closePopup(notice, permanently = false)
        assertFalse(ledger.isUnread(notice))
        val reopened = NoticeLedger("https://one.test", "a", store)
        assertTrue(reopened.shouldShowPopup(notice))
        assertFalse(reopened.isUnread(notice))
    }
    @Test fun accountAndSiteNamespacesKeepDismissalsAndReadStateSeparate() {
        val store = TestNoticeStorage()
        NoticeLedger("https://one.test", "a", store).closePopup(notice, permanently = true)
        for (ledger in listOf(NoticeLedger("https://one.test", "b", store), NoticeLedger("https://two.test", "a", store))) {
            assertTrue(ledger.shouldShowPopup(notice)); assertTrue(ledger.isUnread(notice))
        }
    }
    @Test fun bannerDismissalPersistsOnlyForTheSameContentAndAccount() {
        val store = TestNoticeStorage()
        val ledger = NoticeLedger("https://one.test", "a", store)
        ledger.dismissBanner("original")
        val reopened = NoticeLedger("https://one.test", "a", store)
        assertFalse(reopened.bannerVisible("original"))
        assertTrue(reopened.bannerVisible("updated"))
        assertFalse(reopened.bannerVisible(""))
        assertTrue(NoticeLedger("https://one.test", "b", store).bannerVisible("original"))
    }
    @Test fun readVersionsAndPopupPreferencesPersistWithoutHidingUpdatedNotices() {
        val store = TestNoticeStorage()
        val ledger = NoticeLedger("https://one.test", "a", store)
        ledger.markRead(notice.copy(revision = 2)); ledger.markRead(notice)
        ledger.configurePopups(false)
        val reopened = NoticeLedger("https://one.test", "a", store)
        assertFalse(reopened.isUnread(notice.copy(revision = 2)))
        assertTrue(reopened.isUnread(notice.copy(revision = 3)))
        assertFalse(reopened.shouldShowPopup(notice.copy(revision = 3)))
        reopened.configurePopups(true)
        assertTrue(reopened.shouldShowPopup(notice.copy(revision = 3)))
    }
}
