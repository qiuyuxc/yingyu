package io.github.qiuyuxc.yingyu

import org.junit.Assert.*
import org.junit.Test

class AppNavigationTest {
    @Test fun accountChildrenReturnToTheAccountAndThenToMine() {
        val nav = AppNavigation()
        nav.selectTab(3); nav.navigate("account"); nav.navigate("email")
        nav.back()
        assertEquals("account", nav.page)
        nav.navigate("password"); nav.back()
        assertEquals("account", nav.page)
        nav.back()
        assertEquals("", nav.page); assertEquals(3, nav.tab)
        nav.back()
        assertEquals(0, nav.tab); assertFalse(nav.canGoBack)
    }
    @Test fun albumDetailsReturnToAlbumsAndKeepTheirContextThroughNestedPages() {
        val nav = AppNavigation()
        val album = Album("trip", "旅行", 50)
        nav.selectTab(1); nav.openAlbum(album); nav.navigate("avatar-history")
        nav.back()
        assertEquals("album", nav.page); assertEquals(album, nav.album)
        nav.back()
        assertEquals("", nav.page); assertEquals(1, nav.tab); assertNull(nav.album)
    }
    @Test fun switchingTabsClearsThePreviousNavigationBranch() {
        val nav = AppNavigation()
        nav.selectTab(3); nav.navigate("settings"); nav.navigate("appearance")
        nav.selectTab(2)
        assertEquals("", nav.page)
        nav.back()
        assertEquals(0, nav.tab)
        assertFalse(nav.canGoBack)
    }
    @Test fun repeatedEntryAndAccountResetDoNotLeaveDuplicateOrPrivatePages() {
        val nav = AppNavigation()
        nav.selectTab(3); nav.navigate("account"); nav.navigate("account")
        nav.back()
        assertEquals("", nav.page)
        nav.navigate("tokens"); nav.reset()
        assertEquals(0, nav.tab); assertEquals("", nav.page); assertFalse(nav.canGoBack)
    }
}
