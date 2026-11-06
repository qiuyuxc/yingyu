package io.github.qiuyuxc.yingyu

import androidx.compose.runtime.AbstractApplier
import androidx.compose.runtime.Composition
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Recomposer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.takeOrElse
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.*
import org.junit.Test
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.theme.LocalContentColor
import top.yukonga.miuix.kmp.theme.MiuixTheme
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

class ContentColorThemeTest {
    private class EmptyApplier : AbstractApplier<Unit>(Unit) {
        override fun insertTopDown(index: Int, instance: Unit) = Unit
        override fun insertBottomUp(index: Int, instance: Unit) = Unit
        override fun remove(index: Int, count: Int) = Unit
        override fun move(from: Int, to: Int, count: Int) = Unit
        override fun onClear() = Unit
    }

    private fun contrast(foreground: Color, background: Color): Double {
        fun luminance(color: Color): Double {
            fun channel(value: Float): Double = if (value <= .04045f) value / 12.92 else ((value + .055) / 1.055).pow(2.4)
            return .2126 * channel(color.red) + .7152 * channel(color.green) + .0722 * channel(color.blue)
        }
        val first = luminance(foreground)
        val second = luminance(background)
        return (max(first, second) + .05) / (min(first, second) + .05)
    }

    @Test fun defaultTextFollowsAppearanceChangesInEveryPalette() {
        val recomposer = Recomposer(Dispatchers.Unconfined)
        val composition = Composition(EmptyApplier(), recomposer)
        try {
            for (palette in listOf("mono", "forest", "blue")) {
                for (dark in listOf(false, true, false, true)) {
                    var text = Color.Unspecified
                    var surface = Color.Unspecified
                    composition.setContent {
                        YingyuTheme(palette, dark) {
                            text = MiuixTheme.textStyles.main.color.takeOrElse { LocalContentColor.current }
                            surface = LocalColors.current.panel
                        }
                    }
                    assertEquals("$palette dark=$dark", appPaletteColors(palette, dark).text, text)
                    assertTrue("Unreadable default text in $palette dark=$dark", contrast(text, surface) >= 4.5)
                }
            }
        } finally {
            composition.dispose()
            recomposer.cancel()
        }
    }

    @Test fun darkButtonLabelsRetainContrastWithTheirOwnSurfaces() {
        val recomposer = Recomposer(Dispatchers.Unconfined)
        val composition = Composition(EmptyApplier(), recomposer)
        try {
            var body = Color.Unspecified
            var primaryLabel = Color.Unspecified
            var primarySurface = Color.Unspecified
            var secondaryLabel = Color.Unspecified
            var secondarySurface = Color.Unspecified
            composition.setContent {
                YingyuTheme("mono", true) {
                    body = LocalContentColor.current
                    val primary = ButtonDefaults.buttonColorsPrimary()
                    val secondary = ButtonDefaults.buttonColors()
                    primarySurface = primary.color
                    secondarySurface = secondary.color
                    CompositionLocalProvider(LocalContentColor provides primary.contentColor) {
                        primaryLabel = MiuixTheme.textStyles.main.color.takeOrElse { LocalContentColor.current }
                    }
                    CompositionLocalProvider(LocalContentColor provides secondary.contentColor) {
                        secondaryLabel = MiuixTheme.textStyles.main.color.takeOrElse { LocalContentColor.current }
                    }
                }
            }
            assertTrue(body.red > .7f)
            assertTrue(primaryLabel.red < .15f)
            assertTrue(secondaryLabel.red > .7f)
            assertTrue(contrast(primaryLabel, primarySurface) >= 4.5)
            assertTrue(contrast(secondaryLabel, secondarySurface) >= 4.5)
        } finally {
            composition.dispose()
            recomposer.cancel()
        }
    }
}
