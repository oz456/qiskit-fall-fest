package org.qiskit.fallfest.ui

import android.app.Activity
import android.view.WindowManager
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.qiskit.fallfest.*

/** Blocks screenshots / screen recording / recents thumbnails while the live pass is visible. */
@Composable
private fun SecureWindow(window: android.view.Window?) {
    DisposableEffect(window) {
        window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

/** QR payload + progress that refresh on every 30s window. */
@Composable
private fun rememberLivePass(app: AppState): Pair<String?, Float> {
    var payload by remember { mutableStateOf(app.passPayload()) }
    var progress by remember { mutableFloatStateOf(app.passProgress()) }
    LaunchedEffect(Unit) { while (true) { payload = app.passPayload(); progress = app.passProgress(); delay(250) } }
    return payload to progress
}

@Composable
fun PassScreen(app: AppState, onOpen: (Event) -> Unit, goHub: () -> Unit) {
    var qrOpen by remember { mutableStateOf(false) }
    SecureWindow((LocalContext.current as? Activity)?.window)
    val mine = app.events.filter { it.saved || it.registered }
    val (payload, progress) = rememberLivePass(app)

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 130.dp)) {
        item {
            Column(Modifier.statusBarsPadding().padding(horizontal = 24.dp, vertical = 18.dp)) {
                Text("MY PASS", style = T.label, color = P.muted)
                Text("One pass.\nEvery moment.", style = T.h1.copy(fontSize = 32.sp, lineHeight = 36.sp), color = P.ink)
            }
        }
        item {
            TiltPass(app, payload, progress) { qrOpen = true }
            Spacer(Modifier.height(12.dp))
            Text("Live code · refreshes every 30 seconds. Screenshots won’t scan.", style = T.small, color = P.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp))
            Spacer(Modifier.height(16.dp))
            Row(Modifier.padding(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Stat("Saved", app.events.count { it.saved }.toString(), Modifier.weight(1f))
                Stat("Registered", app.events.count { it.registered }.toString(), Modifier.weight(1f))
                Stat("Check-ins", app.checkins.size.toString(), Modifier.weight(1f))
            }
            Spacer(Modifier.height(28.dp))
            SectionLabel("MY ENROLLED EVENTS", Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
        }
        if (mine.isEmpty()) item {
            Card(Modifier.padding(horizontal = 24.dp).fillMaxWidth(), onClick = goHub) {
                Column(Modifier.padding(24.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    IconBubble(Icons.Outlined.BookmarkAdd, 56.dp, P.mintInk, P.mint); Spacer(Modifier.height(12.dp))
                    Text("Your line-up is open", style = T.title, color = P.ink)
                    Text("Save or register for events from the Hub and they’ll show up here.", style = T.small, color = P.muted, textAlign = TextAlign.Center)
                }
            }
        }
        items(mine, key = { it.id }) { EventRow(it, app, null, Modifier.animateItem().padding(horizontal = 24.dp, vertical = 6.dp), onOpen, trailing = false) }
    }
    if (qrOpen) FullQr(app, payload, progress) { qrOpen = false }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier) {
    Card(modifier, RoundedCornerShape(20.dp)) { Column(Modifier.padding(14.dp)) { Text(value, style = T.h2, color = P.ink); Text(label, style = T.small, color = P.muted) } }
}

@Composable
private fun CountdownRing(progress: Float, modifier: Modifier, color: Color, corner: androidx.compose.ui.unit.Dp = 18.dp) {
    val p by animateFloatAsState(progress, tween(250, easing = LinearEasing), label = "ring")
    Canvas(modifier) {
        val w = 3.dp.toPx(); val inset = w / 2
        val r = corner.toPx() - inset
        val path = androidx.compose.ui.graphics.Path().apply {
            addRoundRect(androidx.compose.ui.geometry.RoundRect(inset, inset, size.width - inset, size.height - inset, CornerRadius(r, r)))
        }
        val measure = androidx.compose.ui.graphics.PathMeasure().apply { setPath(path, false) }
        val seg = androidx.compose.ui.graphics.Path()
        measure.getSegment(0f, measure.length * p, seg, true)
        drawPath(path, color.copy(alpha = .15f), style = Stroke(w))
        drawPath(seg, color, style = Stroke(w, cap = StrokeCap.Round))
    }
}

@Composable
private fun TiltPass(app: AppState, payload: String?, progress: Float, onQr: () -> Unit) {
    val rx = remember { Animatable(0f) }; val ry = remember { Animatable(0f) }
    val scope = rememberCoroutineScope(); val shape = RoundedCornerShape(32.dp)
    val p = app.profile
    Box(
        Modifier.padding(horizontal = 24.dp).fillMaxWidth()
            .graphicsLayer { rotationX = rx.value; rotationY = ry.value; cameraDistance = 22f * density }
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragEnd = { scope.launch { launch { rx.animateTo(0f, spring(0.45f, 120f)) }; launch { ry.animateTo(0f, spring(0.45f, 120f)) } } },
                    onDragCancel = { scope.launch { rx.animateTo(0f); ry.animateTo(0f) } },
                ) { _, d -> scope.launch { ry.snapTo((ry.value + d.x * .08f).coerceIn(-14f, 14f)); rx.snapTo((rx.value - d.y * .08f).coerceIn(-14f, 14f)) } }
            }
            .clip(shape).background(Brush.linearGradient(listOf(P.hero1, P.hero2))).border(1.dp, Color.White.copy(alpha = .12f), shape),
    ) {
        AtomOrb(Modifier.size(260.dp).align(Alignment.TopEnd).offset(70.dp, (-50).dp).alpha(.3f), Color.White, speed = 16000)
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.VerifiedUser, null, tint = Color.White.copy(alpha = .8f), modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp))
                Text("Secure Pass", style = T.bodyM, color = Color.White.copy(alpha = .8f), modifier = Modifier.weight(1f))
                Pill("ACTIVE", Color(0xFF7BE0AD), Color(0xFF08281A))
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text("ATTENDEE", style = T.label, color = Color.White.copy(alpha = .55f)); Spacer(Modifier.height(4.dp))
                    Text((p?.name ?: "").uppercase(), style = T.h1.copy(fontSize = 24.sp, lineHeight = 28.sp), color = Color.White)
                    Spacer(Modifier.height(6.dp))
                    Text("ID: ${p?.passCode.orEmpty()}", style = T.small, color = Color.White.copy(alpha = .75f))
                    p?.college?.let { Text(it, style = T.small, color = Color.White.copy(alpha = .55f), maxLines = 1) }
                }
                Box(Modifier.size(112.dp).pressable(RoundedCornerShape(18.dp), true, onQr).background(Color.White), contentAlignment = Alignment.Center) {
                    if (payload != null) QrCode(payload, Modifier.fillMaxSize().padding(10.dp))
                    CountdownRing(progress, Modifier.fillMaxSize().padding(1.dp), Color(0xFF163226), 18.dp)
                }
            }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = .1f)).pressable(RoundedCornerShape(16.dp), onClick = onQr).padding(vertical = 12.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.QrCode2, null, tint = Color.White, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("TAP TO ENLARGE QR", style = T.label, color = Color.White)
            }
        }
    }
}

@Composable
private fun FullQr(app: AppState, payload: String?, progress: Float, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val win = (LocalView.current.parent as? DialogWindowProvider)?.window
        SecureWindow(win)
        DisposableEffect(win) { // max brightness while the code is on screen so scanners read it fast
            val prev = win?.attributes?.screenBrightness
            win?.attributes = win?.attributes?.also { it.screenBrightness = 1f }
            onDispose { if (prev != null) win?.attributes = win?.attributes?.also { it.screenBrightness = prev } }
        }
        Box(Modifier.fillMaxSize().background(P.bg).clickable(onClick = onDismiss), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp), modifier = Modifier.padding(32.dp)) {
                Text((app.profile?.name ?: "").uppercase(), style = T.h1, color = P.ink)
                Text("ID: ${app.profile?.passCode.orEmpty()}", style = T.body, color = P.muted)
                Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(28.dp)).background(Color.White).border(1.dp, P.line, RoundedCornerShape(28.dp)), contentAlignment = Alignment.Center) {
                    if (payload != null) QrCode(payload, Modifier.fillMaxSize().padding(28.dp))
                    CountdownRing(progress, Modifier.fillMaxSize().padding(2.dp), Color(0xFF163226), 28.dp)
                }
                Text("Live code — it changes every 30 seconds.\nHold steady at the scanner. Tap anywhere to close.", style = T.small, color = P.muted, textAlign = TextAlign.Center)
            }
        }
    }
}
