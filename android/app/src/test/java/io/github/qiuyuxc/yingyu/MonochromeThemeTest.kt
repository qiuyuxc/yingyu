package io.github.qiuyuxc.yingyu

import androidx.compose.ui.graphics.Color
import org.junit.Assert.*
import org.junit.Test

class MonochromeThemeTest {
    private fun neutral(color: Color) {
        assertEquals(color.red, color.green, .0001f)
        assertEquals(color.green, color.blue, .0001f)
    }
    @Test fun backgroundsTextAndControlsStayNeutralInBothModes() {
        for (dark in listOf(false, true)) {
            val palette = appPaletteColors("mono", dark)
            val scheme = appComponentColors(palette, true)
            listOf(palette.background, palette.panel, palette.text, palette.muted, palette.accent,
                scheme.primary, scheme.onPrimary, scheme.primaryVariant, scheme.primaryContainer,
                scheme.disabledPrimaryButton, scheme.disabledOnPrimaryButton,
                scheme.secondaryContainer, scheme.onSecondaryContainer, scheme.tertiaryContainer,
                scheme.background, scheme.surface, scheme.surfaceContainer,
                scheme.onSurface, scheme.onBackgroundVariant, scheme.outline).forEach(::neutral)
        }
    }
    @Test fun darkModeUsesSoftGrayTextOnADarkNeutralSurface() {
        val palette = appPaletteColors("mono", true)
        assertTrue(palette.background.red < .12f)
        assertTrue(palette.panel.red > palette.background.red)
        assertTrue(palette.text.red > .7f && palette.text.red < .95f)
        assertTrue(palette.muted.red < palette.text.red)
        assertEquals(palette.text, appComponentColors(palette, true).onSurface)
    }
}
