package org.qiskit.fallfest.ui

import android.app.Activity
import android.view.WindowManager
import androidx.compose.animation.animateColorAsState
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
import androidx.compose.runtime.saveable.rememberSaveable
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
fun SecureWindow(window: android.view.Window?) {
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
    var teamOpen by remember { mutableStateOf(false) }
    LaunchedEffect(app.flagship, teamOpen) { app.loadTeam() }
    var attendedOpen by rememberSaveable { mutableStateOf(false) } // the Attended list is folded away until its heading is tapped
    SecureWindow((LocalContext.current as? Activity)?.window)
    val saved = app.events.filter { it.saved }
    val attended = app.checkins.entries.sortedByDescending { it.value }.map { app.checkinLabel(it.key, it.value) to it.key.removePrefix("event:").takeIf { k -> it.key.startsWith("event:") } }
    LaunchedEffect(Unit) { while (true) { delay(2000); app.pollCheckins() } } // a door scan shows up within a couple of seconds
    val (payload, progress) = rememberLivePass(app)

    if (teamOpen) {
        TeamSheet(app, { teamOpen = false })
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 130.dp)) {
        item {
            Column(Modifier.statusBarsPadding().padding(horizontal = 24.dp, vertical = 18.dp)) {
                Text("MY PASS", style = T.label, color = P.muted)
                PosterTitle("ONE PASS.", "EVERY MOMENT.")
            }
        }
        item {
            TiltPass(app) { qrOpen = true }
            Spacer(Modifier.height(14.dp))
            Text("QR appears when you tap. It refreshes every 30 seconds.", style = T.small, color = P.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp))
        }
        if (app.flagship) {
            val hack = app.events.firstOrNull { it.track == org.qiskit.fallfest.Track.Hackathon }
            item { SectionLabel("REGISTERED EVENTS", Modifier.padding(horizontal = 24.dp).padding(top = 32.dp, bottom = 8.dp)) }
            item {
                Card(Modifier.padding(horizontal = 24.dp, vertical = 6.dp).fillMaxWidth(), RoundedCornerShape(24.dp), onClick = { teamOpen = true }) {
                    Row(Modifier.padding(horizontal = 18.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        IconBubble(org.qiskit.fallfest.Track.Hackathon.icon, 50.dp, P.mintInk, P.mint)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text("You are registered for the Hackathon", style = T.title, color = P.ink, maxLines = 2)
                            Text(app.team?.let { "Team ${it.name} · tap to see your team" } ?: "Included in your Flagship Pass · tap to see your team", style = T.small, color = P.muted, maxLines = 1)
                        }
                        Icon(Icons.Outlined.ChevronRight, null, tint = P.muted, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
        if (saved.isNotEmpty()) {
            item { SectionLabel("SAVED EVENTS", Modifier.padding(horizontal = 24.dp).padding(top = 32.dp, bottom = 8.dp)) }
            items(saved, key = { it.id }) { EventRow(it, app, null, Modifier.animateItem().padding(horizontal = 24.dp, vertical = 6.dp), onOpen) }
        } else item {
            Text("Events you save appear here. Tap the bookmark on any event to save it.", style = T.body, color = P.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 36.dp))
        }
        // attended events sit below, folded away: only the heading and an arrow show until it is tapped
        item {
            val rot by animateFloatAsState(if (attendedOpen) 90f else 0f, label = "fold")
            Row(Modifier.fillMaxWidth().clickable { attendedOpen = !attendedOpen }.padding(horizontal = 24.dp).padding(top = 28.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                SectionLabel("ATTENDED EVENTS (${attended.size})", Modifier.weight(1f))
                Icon(Icons.Outlined.ChevronRight, if (attendedOpen) "Hide" else "Show", tint = P.muted, modifier = Modifier.size(20.dp).graphicsLayer { rotationZ = rot })
            }
        }
        if (attendedOpen) {
            if (attended.isEmpty()) item {
                Text("Events you attend appear here after the team scans your pass at the door.", style = T.body, color = P.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 24.dp))
            } else items(attended, key = { it.first.title + it.first.time }) { (n, id) ->
                val ev = id?.let { k -> app.events.firstOrNull { it.id == k } }
                Card(Modifier.padding(horizontal = 24.dp, vertical = 6.dp).fillMaxWidth(), RoundedCornerShape(24.dp), onClick = { ev?.let(onOpen) }) {
                    Row(Modifier.padding(horizontal = 18.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        IconBubble(Icons.Outlined.CheckCircle, 50.dp, P.mintInk, P.mint)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(n.title, style = T.title, color = P.ink, maxLines = 2)
                            Text("Checked in · ${n.time}", style = T.small, color = P.muted, maxLines = 1)
                            if (id != null && id in app.odPending) Text("Add OD details", style = T.small, color = P.primary, modifier = Modifier.pressable(RoundedCornerShape(8.dp)) { app.odDismissed = app.odDismissed - id }.padding(vertical = 4.dp))
                        }
                    }
                }
            }
        }
    }
    // a forgotten QR must not stay on screen: close it after 2 minutes
    LaunchedEffect(qrOpen) { if (qrOpen) { delay(120_000); qrOpen = false } }
    if (qrOpen) FullQr(app, payload, progress) { qrOpen = false }
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
private fun TiltPass(app: AppState, onQr: () -> Unit) {
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
            .clip(shape).background(Brush.linearGradient(listOf(P.hero1, P.hero2))).pressable(shape, false, onQr).border(1.dp, Color.White.copy(alpha = .12f), shape),
    ) {
        AtomOrb(Modifier.size(300.dp).align(Alignment.CenterEnd).offset(x = 128.dp).alpha(.75f), Color(0xFFF2E7D7), P.accent, speed = 12000)
        Column(Modifier.padding(26.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.VerifiedUser, null, tint = Color.White.copy(alpha = .8f), modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp))
                Text(when (app.passType) { "flagship" -> "₹499 Pass"; "general" -> "₹99 Pass"; else -> "Secure Pass" }, style = T.bodyM, color = Color.White.copy(alpha = .8f), modifier = Modifier.weight(1f))
                Pill("ACTIVE", Color(0xFFF2E7D7), P.primary)
            }
            Column {
                Text("ATTENDEE", style = T.label, color = Color.White.copy(alpha = .55f)); Spacer(Modifier.height(4.dp))
                Text((p?.name ?: "").uppercase(), style = T.poster.copy(fontSize = 34.sp, lineHeight = 36.sp), color = Color.White, maxLines = 2)
                Spacer(Modifier.height(6.dp))
                Text("ID: ${p?.passCode.orEmpty()}", style = T.body, color = Color.White.copy(alpha = .8f))
                p?.college?.let { Text(it, style = T.small, color = Color.White.copy(alpha = .55f), maxLines = 1) }
            }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).pressable(RoundedCornerShape(18.dp), true, onQr).padding(vertical = 16.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.QrCode2, null, tint = P.hero2, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(10.dp)); Text("TAP TO SHOW QR", style = T.button, color = P.hero2)
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
                    CountdownRing(progress, Modifier.fillMaxSize().padding(2.dp), P.primary, 28.dp)
                }
                Text("Live code — it changes every 30 seconds.\nHold steady at the scanner. Tap anywhere to close.", style = T.small, color = P.muted, textAlign = TextAlign.Center)
            }
        }
    }
}
