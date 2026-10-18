package org.qiskit.fallfest.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import org.qiskit.fallfest.R

class Palette(
    val bg: Color,
    val surface: Color,
    val surfaceAlt: Color,
    val ink: Color,
    val muted: Color,
    val line: Color,
    val primary: Color,
    val onPrimary: Color,
    val mint: Color,
    val mintInk: Color,
    val accent: Color,
    val hero1: Color,
    val hero2: Color,
    val danger: Color,
)

/** Single light palette taken from the fest poster: cream paper, deep maroon, warm black ink and the orange sun. No dark mode. */
val LightPalette = Palette(
    bg = Color(0xFFF2E7D7), surface = Color(0xFFFBF6EC), surfaceAlt = Color(0xFFE9DCC6),
    ink = Color(0xFF161818), muted = Color(0xFF6F5E54), line = Color(0xFFE0D1BB),
    primary = Color(0xFF7E1322), onPrimary = Color(0xFFFBF3E6),
    mint = Color(0xFFEBD4CA), mintInk = Color(0xFF7E1322), accent = Color(0xFFEB732F),
    hero1 = Color(0xFF911729), hero2 = Color(0xFF4B181F), danger = Color(0xFFB3261E),
)

val LocalPalette = staticCompositionLocalOf { LightPalette }
val P: Palette @Composable get() = LocalPalette.current

@OptIn(ExperimentalTextApi::class)
private fun family(res: Int, vararg weights: FontWeight) = FontFamily(
    weights.map {
        Font(res, it, variationSettings = FontVariation.Settings(FontVariation.weight(it.weight)))
    }
)

val Display = family(R.font.manrope, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold, FontWeight.ExtraBold)
val Poster = FontFamily(Font(R.font.anton, FontWeight.Normal))
val Body = family(R.font.dmsans, FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold)

object T {
    val hero = TextStyle(fontFamily = Poster, fontSize = 60.sp, lineHeight = 62.sp, letterSpacing = 0.5.sp)
    /** Poster display type (Anton): page titles, big numerals. */
    val poster = TextStyle(fontFamily = Poster, fontSize = 40.sp, lineHeight = 42.sp, letterSpacing = 0.4.sp)
    val h1 = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 28.sp, lineHeight = 32.sp, letterSpacing = (-0.8).sp)
    val h2 = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 27.sp, letterSpacing = (-0.5).sp)
    val title = TextStyle(fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp, letterSpacing = (-0.2).sp)
    val body = TextStyle(fontFamily = Body, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 22.sp)
    val bodyM = TextStyle(fontFamily = Body, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp)
    val small = TextStyle(fontFamily = Body, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 18.sp)
    val label = TextStyle(fontFamily = Body, fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 1.3.sp)
    val button = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = 1.sp)
}

@Composable
fun QffTheme(content: @Composable () -> Unit) {
    val p = LightPalette
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(
            colorScheme = lightColorScheme(primary = p.primary, background = p.bg, surface = p.surface, onSurface = p.ink),
            content = content,
        )
    }
}
