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
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect
import dev.chrisbanes.haze.hazeSource
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
    val glass = remember { HazeState() }
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) { // coming back to the app = a fresh schedule and any new support replies
        val obs = androidx.lifecycle.LifecycleEventObserver { _, ev -> if (ev == androidx.lifecycle.Lifecycle.Event.ON_RESUME) app.refresh() }
        lifecycle.addObserver(obs); onDispose { lifecycle.removeObserver(obs) }
    }
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
            else if (app.needsDetails || app.needsExtra) DetailsScreen(app, extra = !app.needsDetails)
            else if (app.needsSelfie) SelfieScreen(app)
            else Box(Modifier.fillMaxSize()) {
                BackHandler(tab != Tab.Hub) { tab = Tab.Hub }
                AnimatedContent(
                    tab, label = "tabs", modifier = Modifier.hazeSource(glass),
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
                BottomBar(tab, glass, app.newReplies, Modifier.align(Alignment.BottomCenter)) { tab = it }
            }
        }
    }

    eventId?.let { EventSheet(it, app) { eventId = null } }
    if (sheet != SheetKind.None) SupportSheet(sheet, app) { sheet = SheetKind.None }
    if (notifs) NotificationsSheet(app) { notifs = false }
    app.message?.let { msg -> Toast(msg) { app.message = null } }
    if (profile) ProfileSheet(app) { profile = false }
    // OD details come after the "You're checked in" popup, for events that collect them; "Later" keeps an "Add OD details" button on My Pass
    app.odPending.firstOrNull { it !in app.odDismissed }?.let { if (app.checkinNotice == null && !app.needsDetails && !app.needsExtra && !app.needsSelfie) OdDialog(app, it) }
    app.checkinNotice?.let { n ->
        AlertDialog(
            onDismissRequest = { app.checkinNotice = null }, containerColor = P.bg,
            icon = { IconBubble(Icons.Outlined.CheckCircle, 64.dp, P.mintInk, P.mint) },
            title = { Text("You’re checked in", style = T.h1.copy(fontSize = 24.sp, lineHeight = 28.sp), color = P.ink, textAlign = androidx.compose.ui.text.style.TextAlign.Center) },
            text = { Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) { Text(n.title, style = T.title, color = P.ink, textAlign = androidx.compose.ui.text.style.TextAlign.Center); Text(n.time, style = T.small, color = P.muted) } },
            confirmButton = { TextButton({ app.checkinNotice = null }) { Text("OK", color = P.primary) } },
        )
    }

    // A tapped notification opens the right place once the app is ready (signed in, selfie done).
    LaunchedEffect(app.pendingOpen, app.signedIn, app.needsSelfie) {
        val open = app.pendingOpen ?: return@LaunchedEffect
        if (!app.signedIn || app.needsSelfie) return@LaunchedEffect
        when (open) { "ticket" -> tab = Tab.Support; "announcement" -> { tab = Tab.Hub; notifs = true; app.markAnnouncementsSeen() } }
        app.pendingOpen = null
        app.refresh()
    }

    // Ask for notification permission once, a moment after the attendee first lands on the Hub (right after sign-in and selfie).
    var askNotif by remember { mutableStateOf(false) }
    LaunchedEffect(app.signedIn, app.needsSelfie) {
        if (app.shouldAskNotifications()) { kotlinx.coroutines.delay(1500); if (app.shouldAskNotifications()) askNotif = true }
        else if (app.signedIn && !app.needsSelfie) app.syncPush() // Android 12 and older: no prompt needed
    }
    if (askNotif) NotificationPrompt(app) { askNotif = false }
}

/** Why we want notifications, in two lines, before the system dialog appears. Asked once. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NotificationPrompt(app: AppState, onDone: () -> Unit) {
    val launcher = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { granted ->
        app.markNotificationsAsked(); app.notificationsChanged(); onDone()
    }
    ModalBottomSheet(onDismissRequest = { app.markNotificationsAsked(); onDone() }, containerColor = P.bg, dragHandle = { BottomSheetDefaults.DragHandle(color = P.line) }) {
        Column(Modifier.padding(horizontal = 28.dp).padding(bottom = 28.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            IconBubble(Icons.Outlined.NotificationsActive, 60.dp, P.mintInk, P.mint)
            Text("Never miss an update", style = T.h1.copy(fontSize = 26.sp, lineHeight = 30.sp), color = P.ink)
            Text("We’ll notify you the moment the team posts an announcement or replies to your support ticket. Nothing else, ever.", style = T.body, color = P.muted)
            PrimaryButton("TURN ON NOTIFICATIONS") { if (android.os.Build.VERSION.SDK_INT >= 33) launcher.launch(android.Manifest.permission.POST_NOTIFICATIONS) }
            Text("Not now", style = T.bodyM, color = P.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.fillMaxWidth().pressable(RoundedCornerShape(12.dp)) { app.markNotificationsAsked(); onDone() }.padding(12.dp))
        }
    }
}

@Composable
private fun BottomBar(selected: Tab, glass: HazeState, supportDot: Boolean, modifier: Modifier, onSelect: (Tab) -> Unit) {
    val hf = LocalHapticFeedback.current
    val shape = RoundedCornerShape(32.dp)
    Row(
        modifier.navigationBarsPadding().padding(horizontal = 20.dp, vertical = 14.dp).fillMaxWidth()
            .shadow(18.dp, shape, ambientColor = Color(0x33000000), spotColor = Color(0x33000000))
            .clip(shape).hazeEffect(glass, HazeStyle(backgroundColor = P.bg, tint = HazeTint(P.surface.copy(alpha = .62f)), blurRadius = 24.dp)).border(1.dp, Color.White.copy(alpha = .7f), shape).padding(8.dp),
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
                Box {
                    Icon(if (sel) t.on else t.off, t.label, tint = fg, modifier = Modifier.size(24.dp))
                    if (t == Tab.Support && supportDot) Box(Modifier.align(Alignment.TopEnd).offset(x = 3.dp, y = (-2).dp).size(10.dp).clip(CircleShape).background(P.danger).border(1.5.dp, if (sel) P.primary else P.surface, CircleShape))
                }
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
            val ctx = androidx.compose.ui.platform.LocalContext.current
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(P.surface).border(1.dp, P.line, RoundedCornerShape(18.dp)).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (app.notifEnabled) Icons.Outlined.NotificationsActive else Icons.Outlined.NotificationsOff, null, tint = P.muted, modifier = Modifier.size(22.dp)); Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) { Text("Notifications", style = T.bodyM, color = P.ink); Text(if (app.notifEnabled) "On: announcements and support replies" else "Off", style = T.small, color = P.muted) }
                if (!app.notifEnabled) Text("TURN ON", style = T.label, color = P.primary, modifier = Modifier.pressable(CircleShape) {
                    ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.packageName).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                }.padding(8.dp))
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
