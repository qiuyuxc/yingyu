package io.github.qiuyuxc.yingyu

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** The indicator previews the finger position; navigation commits on release. */
class TabBarDrag(private val count: Int = 4) {
    var active by mutableStateOf(false); private set
    var position by mutableFloatStateOf(0f); private set
    var candidate by mutableIntStateOf(0); private set
    private var original = 0

    fun start(x: Float, width: Float, selected: Int) {
        if (width <= 0f) return
        original = selected.coerceIn(0, count - 1)
        active = true
        move(x, width)
    }
    fun move(x: Float, width: Float) {
        if (!active || width <= 0f) return
        val item = width / count
        position = (x / item - .5f).coerceIn(0f, (count - 1).toFloat())
        candidate = (x / item).toInt().coerceIn(0, count - 1)
    }
    fun finish(): Int? {
        if (!active) return null
        active = false
        return candidate
    }
    fun cancel() {
        active = false
        candidate = original
        position = original.toFloat()
    }
}
