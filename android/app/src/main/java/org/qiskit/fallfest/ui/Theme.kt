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

/** Single light palette (no dark mode): quantum indigo + IBM-style violet, cyan electrons. */
val LightPalette = Palette(
    bg = Color(0xFFF5F6FB), surface = Color(0xFFFFFFFF), surfaceAlt = Color(0xFFECEEF8),
    ink = Color(0xFF0E1030), muted = Color(0xFF666B8A), line = Color(0xFFE2E4F0),
    primary = Color(0xFF3A1FA8), onPrimary = Color(0xFFFFFFFF),
    mint = Color(0xFFE9E4FB), mintInk = Color(0xFF4A22B8), accent = Color(0xFF7DE3FF),
    hero1 = Color(0xFF3B22A8), hero2 = Color(0xFF0B0A2A), danger = Color(0xFFC0392B),
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
val Body = family(R.font.dmsans, FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold)

object T {
    val hero = TextStyle(fontFamily = Display, fontWeight = FontWeight.Medium, fontSize = 44.sp, lineHeight = 46.sp, letterSpacing = (-1.8).sp)
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
