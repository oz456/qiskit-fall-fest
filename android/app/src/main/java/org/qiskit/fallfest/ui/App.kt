package org.qiskit.fallfest.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.qiskit.fallfest.*

private enum class Tab(val label: String, val off: ImageVector, val on: ImageVector) {
    Hub("Hub", Icons.Outlined.Home, Icons.Filled.Home),
    Pass("My Pass", Icons.Outlined.ConfirmationNumber, Icons.Filled.ConfirmationNumber),
    Support("Support", Icons.Outlined.Headset, Icons.Filled.Headset),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun App(app: AppState) {
    var tab by remember { mutableStateOf(Tab.Hub) }
    var eventId by remember { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf<SheetKind>(SheetKind.None) }
    var notifs by remember { mutableStateOf(false) }
    var profile by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(P.bg).drawBehind { drawCircle(Brush.radialGradient(listOf(Color(0xFFEB732F).copy(alpha = .13f), Color.Transparent), center = Offset(size.width * 0.85f, 0f), radius = size.width * 0.75f), radius = size.width * 0.75f, center = Offset(size.width * 0.85f, 0f)) }) {
        AnimatedContent(
            app.signedIn, label = "auth",
            transitionSpec = { (fadeIn(tween(500)) + scaleIn(initialScale = .96f, animationSpec = tween(500))) togetherWith fadeOut(tween(250)) },
        ) { signedIn ->
            if (!signedIn) SignInScreen(app)
            else if (app.needsSelfie) SelfieScreen(app)
            else Box(Modifier.fillMaxSize()) {
                BackHandler(tab != Tab.Hub) { tab = Tab.Hub }
                AnimatedContent(
                    tab, label = "tabs",
                    transitionSpec = {
                        val dir = if (targetState.ordinal > initialState.ordinal) 1 else -1
                        (slideInHorizontally(tween(380, easing = FastOutSlowInEasing)) { it / 6 * dir } + fadeIn(tween(300))) togetherWith
                            (slideOutHorizontally(tween(380, easing = FastOutSlowInEasing)) { -it / 6 * dir } + fadeOut(tween(180)))
                    },
                ) { t ->
                    when (t) {
                        Tab.Hub -> HubScreen(app, { eventId = it.id }, { notifs = true; app.markAnnouncementsSeen() }, { profile = true })
                        Tab.Pass -> PassScreen(app, { eventId = it.id }) { tab = Tab.Hub }
                        Tab.Support -> SupportScreen(app) { sheet = it }
                    }
                }
                BottomBar(tab, Modifier.align(Alignment.BottomCenter)) { tab = it }
            }
        }
    }

    eventId?.let { EventSheet(it, app) { eventId = null } }
    if (sheet != SheetKind.None) SupportSheet(sheet, app) { sheet = SheetKind.None }
    if (notifs) NotificationsSheet(app) { notifs = false }
    app.message?.let { msg -> Toast(msg) { app.message = null } }
    if (profile) ProfileSheet(app) { profile = false }
}

@Composable
private fun BottomBar(selected: Tab, modifier: Modifier, onSelect: (Tab) -> Unit) {
    val hf = LocalHapticFeedback.current
    val shape = RoundedCornerShape(32.dp)
    Row(
        modifier.navigationBarsPadding().padding(horizontal = 20.dp, vertical = 14.dp).fillMaxWidth()
            .shadow(18.dp, shape, ambientColor = Color(0x33000000), spotColor = Color(0x33000000))
            .clip(shape).background(P.surface).border(1.dp, P.line, shape).padding(8.dp),
    ) {
        Tab.entries.forEach { t ->
            val sel = t == selected
            val bg by animateColorAsState(if (sel) P.primary else Color.Transparent, tween(250), label = "bg")
            val fg by animateColorAsState(if (sel) P.onPrimary else P.muted, tween(250), label = "fg")
            Row(
                Modifier.weight(if (sel) 1.5f else 1f).animateContentSize(spring(0.8f, 400f)).height(52.dp).clip(CircleShape)
                    .clickable { if (!sel) { hf.performHapticFeedback(HapticFeedbackType.SegmentTick); onSelect(t) } }.background(bg),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (sel) t.on else t.off, t.label, tint = fg, modifier = Modifier.size(24.dp))
                AnimatedVisibility(sel, enter = fadeIn() + expandHorizontally(), exit = fadeOut() + shrinkHorizontally()) {
                    Text(t.label, style = T.bodyM.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold), color = fg, modifier = Modifier.padding(start = 8.dp), maxLines = 1)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NotificationsSheet(app: AppState, onDismiss: () -> Unit) {
    val fmt = java.time.format.DateTimeFormatter.ofPattern("d MMM, h:mm a").withZone(IST)
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = P.bg, dragHandle = { BottomSheetDefaults.DragHandle(color = P.line) }) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 28.dp).navigationBarsPadding().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Announcements", style = T.h1, color = P.ink, modifier = Modifier.padding(bottom = 6.dp))
            if (app.announcements.isEmpty()) Text("Nothing yet. Organisers’ updates will show up here.", style = T.body, color = P.muted)
            app.announcements.forEach { a ->
                Card(Modifier.fillMaxWidth(), RoundedCornerShape(20.dp)) {
                    Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        IconBubble(Icons.Outlined.Campaign, 44.dp, P.mintInk, P.mint)
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(a.title, style = T.title.copy(fontSize = 16.sp), color = P.ink); Text(a.body, style = T.small, color = P.muted)
                            Text(fmt.format(a.at), style = T.small.copy(fontSize = 12.sp), color = P.muted.copy(alpha = .7f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Toast(text: String, onDone: () -> Unit) {
    LaunchedEffect(text) { delay(3000); onDone() }
    Box(Modifier.fillMaxSize().navigationBarsPadding().padding(bottom = 104.dp), contentAlignment = Alignment.BottomCenter) {
        Text(text, style = T.bodyM, color = P.bg, modifier = Modifier.padding(horizontal = 24.dp).clip(CircleShape).background(P.ink).padding(horizontal = 20.dp, vertical = 12.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProfileSheet(app: AppState, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = P.bg, dragHandle = { BottomSheetDefaults.DragHandle(color = P.line) }) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 28.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Box(Modifier.size(64.dp).clip(CircleShape).background(P.primary), contentAlignment = Alignment.Center) {
                    Text(app.profile?.initials.orEmpty(), style = T.h2, color = P.onPrimary)
                }
                Column {
                    Text(app.profile?.name.orEmpty(), style = T.h2, color = P.ink)
                    Text("${app.profile?.email.orEmpty()} · Attendee", style = T.small, color = P.muted)
                }
            }
            Row(
                Modifier.fillMaxWidth().height(56.dp).pressable(CircleShape, true) { app.signOut(); onDismiss() }.border(1.dp, P.line, CircleShape),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Logout, null, tint = P.danger, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(10.dp))
                Text("SIGN OUT", style = T.button, color = P.danger)
            }
        }
    }
}
