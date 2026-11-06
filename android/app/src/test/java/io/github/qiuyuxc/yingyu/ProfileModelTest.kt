package io.github.qiuyuxc.yingyu

import org.junit.Assert.*
import org.junit.Test

class ProfileModelTest {
    private val user = User("owner", "名字", "owner@example.test", "user", 1024, 0, 0, 0, null)
    @Test fun savedSessionsKeepAvatarRetentionAndAccountMetadata() {
        val complete = user.copy(tier = "创作空间", avatarLibraryEnabled = true, avatarLibraryExpiresAt = "2026-12-01T00:00:00Z", avatarHistoryCount = 4)
        val session = ClientSession("https://images.test", "app-token", "2026-12-31T00:00:00Z", complete)
        assertEquals(session, ClientSession.from(session.json()))
    }
    @Test fun olderSavedSessionsLoadWithSafeDefaultsForAddedFields() {
        val old = user.json()
        for (key in listOf("tier", "avatarLibraryEnabled", "avatarLibraryExpiresAt", "avatarHistoryCount")) old.remove(key)
        val restored = User.from(old)
        assertEquals(user, restored)
        assertFalse(restored.avatarLibraryEnabled)
        assertNull(restored.avatarLibraryExpiresAt)
    }
}
