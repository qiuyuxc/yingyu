package io.github.qiuyuxc.yingyu

import org.junit.Assert.*
import org.junit.Test

class TabBarDragTest {
    @Test fun draggingPreviewsTheTargetAndCommitsOnlyOnRelease() {
        val nav = AppNavigation()
        nav.selectTab(1)
        val drag = TabBarDrag()
        drag.start(150f, 400f, nav.tab)
        drag.move(350f, 400f)
        assertTrue(drag.active)
        assertEquals(3, drag.candidate)
        assertEquals(1, nav.tab)
        drag.finish()?.let(nav::selectTab)
        assertFalse(drag.active)
        assertEquals(3, nav.tab)
    }
    @Test fun cancellingRestoresTheOriginalIndicatorAndDoesNotNavigate() {
        val nav = AppNavigation()
        nav.selectTab(2)
        val drag = TabBarDrag()
        drag.start(250f, 400f, nav.tab)
        drag.move(30f, 400f)
        drag.cancel()
        assertFalse(drag.active)
        assertEquals(2, drag.candidate)
        assertEquals(2f, drag.position, .001f)
        assertEquals(2, nav.tab)
        assertNull(drag.finish())
    }
    @Test fun draggingOutsideTheBarStaysAtTheNearestEnd() {
        val drag = TabBarDrag()
        drag.start(150f, 400f, 1)
        drag.move(-200f, 400f)
        assertEquals(0, drag.candidate)
        assertEquals(0f, drag.position, .001f)
        drag.move(1000f, 400f)
        assertEquals(3, drag.candidate)
        assertEquals(3f, drag.position, .001f)
        assertEquals(3, drag.finish())
    }
    @Test fun theIndicatorTracksTheFingerBetweenTabCenters() {
        val drag = TabBarDrag()
        drag.start(50f, 400f, 0)
        drag.move(125f, 400f)
        assertEquals(.75f, drag.position, .001f)
        assertEquals(1, drag.candidate)
        drag.move(175f, 400f)
        assertEquals(1.25f, drag.position, .001f)
        assertEquals(1, drag.finish())
    }
}
