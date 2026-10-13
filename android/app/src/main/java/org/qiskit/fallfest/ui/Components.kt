package org.qiskit.fallfest.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/** Springy press feedback for any tappable. */
fun Modifier.pressable(
    shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(0.dp),
    haptic: Boolean = false,
    onClick: () -> Unit,
): Modifier = composed {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.965f else 1f, spring(0.55f, 600f), label = "press")
    val hf = LocalHapticFeedback.current
    this
        .scale(s)
        .clip(shape)
        .clickable(src, androidx.compose.material3.ripple()) {
            if (haptic) hf.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onClick()
        }
}

/** Animated quantum atom: three tilted orbits with electrons. */
@Composable
fun AtomOrb(
    modifier: Modifier = Modifier,
    color: Color = P.ink,
    electron: Color = P.accent,
    stroke: Dp = 1.2.dp,
    speed: Int = 9000,
) {
    val t = rememberInfiniteTransition(label = "atom")
    val a by t.animateFloat(0f, 360f, infiniteRepeatable(tween(speed, easing = LinearEasing)), label = "a")
    Canvas(modifier) {
        val c = center
        val rx = size.minDimension * 0.46f
        val ry = rx * 0.36f
        val sw = stroke.toPx()
        listOf(0f, 60f, 120f).forEachIndexed { i, rot ->
            rotate(rot, c) {
                drawOval(color.copy(alpha = 0.55f), Offset(c.x - rx, c.y - ry), Size(rx * 2, ry * 2), style = Stroke(sw))
                val ang = Math.toRadians((a * (if (i == 1) -1.0 else 1.0) + i * 120.0))
                drawCircle(electron, sw * 3.2f, Offset(c.x + rx * Math.cos(ang).toFloat(), c.y + ry * Math.sin(ang).toFloat()))
            }
        }
        drawCircle(color, sw * 4.4f, c)
    }
}

/** Official Qiskit mark, no tile: the glyph sits directly on the page. */
@Composable
fun QiskitMark(size: Dp = 40.dp, tint: Color = Color(0xFF6929C4)) {
    androidx.compose.material3.Icon(androidx.compose.ui.res.painterResource(org.qiskit.fallfest.R.drawable.ic_qiskit), "Qiskit", tint = tint, modifier = Modifier.size(size))
}

@Composable
fun Logo(modifier: Modifier = Modifier, color: Color = P.ink) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        QiskitMark()
        Column {
            Text("QISKIT", style = T.title.copy(letterSpacing = 0.3.sp), color = color)
            Text("FALL FEST ’26", style = T.title.copy(letterSpacing = 0.3.sp), color = color)
        }
    }
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, loading: Boolean = false, enabled: Boolean = true, icon: @Composable (() -> Unit)? = null, onClick: () -> Unit) {
    Box(
        modifier
            .fillMaxWidth().height(58.dp)
            .pressable(CircleShape, haptic = true) { if (enabled && !loading) onClick() }
            .background(if (enabled) P.primary else P.primary.copy(alpha = 0.4f)),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            androidx.compose.material3.CircularProgressIndicator(Modifier.size(22.dp), color = P.onPrimary, strokeWidth = 2.5.dp)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(text, style = T.button, color = P.onPrimary)
                icon?.invoke()
            }
        }
    }
}

@Composable
fun Pill(text: String, bg: Color, fg: Color, dot: Boolean = false, modifier: Modifier = Modifier) {
    Row(
        modifier.clip(CircleShape).background(bg).padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (dot) PulseDot(fg)
        Text(text, style = T.label.copy(fontSize = 10.sp, letterSpacing = 0.8.sp), color = fg)
    }
}

@Composable
fun PulseDot(color: Color, size: Dp = 6.dp) {
    val t = rememberInfiniteTransition(label = "pulse")
    val r by t.animateFloat(1f, 2.4f, infiniteRepeatable(tween(1300), RepeatMode.Restart), label = "r")
    val al by t.animateFloat(0.5f, 0f, infiniteRepeatable(tween(1300), RepeatMode.Restart), label = "al")
    Canvas(Modifier.size(size * 2.4f)) {
        drawCircle(color.copy(alpha = al), size.toPx() / 2 * r)
        drawCircle(color, size.toPx() / 2)
    }
}

@Composable
fun Card(modifier: Modifier = Modifier, shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(24.dp), onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val m = modifier.clip(shape).background(P.surface).border(1.dp, P.line, shape)
    Column(if (onClick != null) m.pressable(shape, onClick = onClick) else m, content = content)
}

@Composable
fun IconBubble(icon: androidx.compose.ui.graphics.vector.ImageVector, size: Dp = 48.dp, tint: Color = P.ink, bg: Color = P.surfaceAlt) {
    Box(Modifier.size(size).clip(RoundedCornerShape(size * 0.32f)).background(bg), contentAlignment = Alignment.Center) {
        androidx.compose.material3.Icon(icon, null, tint = tint, modifier = Modifier.size(size * 0.5f))
    }
}

/** Real, scannable QR drawn with soft rounded modules. */
@Composable
fun QrCode(content: String, modifier: Modifier = Modifier, fg: Color = Color(0xFF0E1030), bg: Color = Color.White) {
    val matrix = remember(content) {
        QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 0, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M))
    }
    Canvas(modifier.background(bg)) {
        val n = matrix.width
        val cell = size.width / n
        for (y in 0 until n) for (x in 0 until n) if (matrix[x, y]) {
            drawRoundRect(fg, Offset(x * cell, y * cell), Size(cell + 0.6f, cell + 0.6f), CornerRadius(cell * 0.28f))
        }
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) =
    Text(text, style = T.label, color = P.muted, modifier = modifier)
