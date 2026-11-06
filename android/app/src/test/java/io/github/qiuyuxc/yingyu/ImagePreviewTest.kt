package io.github.qiuyuxc.yingyu

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntSize
import org.junit.Assert.*
import org.junit.Test

class ImagePreviewTest {
    @Test fun portraitPhotosCannotBeDraggedAwayThroughTheirLetterboxedSides() {
        val result = boundedPan(Offset(1000f, -1000f), 2f, IntSize(300, 200), IntSize(800, 1200))
        assertEquals(0f, result.x, .01f)
        assertEquals(-100f, result.y, .01f)
        assertEquals(Offset.Zero, boundedPan(Offset(100f, 100f), 1f, IntSize(300, 200), IntSize(800, 1200)))
    }
    @Test fun widePhotosClampToTheDecodedImageAndChangingViewport() {
        val result = boundedPan(Offset(-1000f, 1000f), 2f, IntSize(300, 200), IntSize(1600, 400))
        assertEquals(-150f, result.x, .01f)
        assertEquals(0f, result.y, .01f)
        val resized = boundedPan(result, 2f, IntSize(100, 200), IntSize(1600, 400))
        assertEquals(-50f, resized.x, .01f)
        assertEquals(0f, resized.y, .01f)
    }
}
