package io.github.qiuyuxc.yingyu

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

data class ScreenDestination(val page: String, val tab: Int, val album: Album? = null) {
    val key get() = page.ifEmpty { "tab-" + tab } + if (page == "album") ":" + album?.id else ""
}

class AppNavigation {
    var page by mutableStateOf(""); private set
    var tab by mutableIntStateOf(0); private set
    var album by mutableStateOf<Album?>(null); private set
    var returning by mutableStateOf(false); private set
    private val history = mutableListOf<ScreenDestination>()
    val destination get() = ScreenDestination(page, tab, album)
    val canGoBack get() = history.isNotEmpty() || page.isNotEmpty() || tab != 0

    fun navigate(route: String) {
        if (page == route) return
        require(route.isNotEmpty())
        history += destination
        returning = false
        page = route
    }
    fun openAlbum(value: Album) {
        if (page == "album" && album?.id == value.id) return
        history += destination
        returning = false
        album = value
        page = "album"
    }
    fun selectTab(index: Int) {
        require(index in 0..3)
        history.clear()
        returning = false
        page = ""
        album = null
        tab = index
    }
    fun back(): Boolean {
        returning = true
        if (history.isNotEmpty()) {
            val previous = history.removeAt(history.lastIndex)
            page = previous.page; tab = previous.tab; album = previous.album
        } else if (page.isNotEmpty()) {
            page = ""; album = null
        } else if (tab != 0) {
            tab = 0
        } else return false
        return true
    }
    fun reset() = selectTab(0)
}
