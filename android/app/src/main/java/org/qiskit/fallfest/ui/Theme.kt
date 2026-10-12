package org.qiskit.fallfest.ui

import androidx.compose.foundation.isSystemInDarkTheme
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
    val dark: Boolean,
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

val LightPalette = Palette(
    dark = false,
    bg = Color(0xFFF6F5F0), surface = Color(0xFFFFFFFF), surfaceAlt = Color(0xFFEFEEE8),
    ink = Color(0xFF111A16), muted = Color(0xFF6B7470), line = Color(0xFFE6E4DB),
    primary = Color(0xFF163226), onPrimary = Color(0xFFFFFFFF),
    mint = Color(0xFFDDF3E6), mintInk = Color(0xFF17583C), accent = Color(0xFF7BE0AD),
    hero1 = Color(0xFF1F4A39), hero2 = Color(0xFF0B1A13), danger = Color(0xFFC0392B),
)
val DarkPalette = Palette(
    dark = true,
    bg = Color(0xFF0C1511), surface = Color(0xFF142019), surfaceAlt = Color(0xFF1B2A22),
    ink = Color(0xFFF0F5F2), muted = Color(0xFF93A29A), line = Color(0xFF243529),
    primary = Color(0xFF7BE0AD), onPrimary = Color(0xFF0A1A12),
    mint = Color(0xFF1B3A2C), mintInk = Color(0xFF8FE8BA), accent = Color(0xFF7BE0AD),
    hero1 = Color(0xFF1F4A39), hero2 = Color(0xFF08110D), danger = Color(0xFFFF8A7A),
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
    val p = if (isSystemInDarkTheme()) DarkPalette else LightPalette
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(
            colorScheme = lightColorScheme(primary = p.primary, background = p.bg, surface = p.surface, onSurface = p.ink),
            content = content,
        )
    }
}
