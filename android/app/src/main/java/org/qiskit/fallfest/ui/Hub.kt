package org.qiskit.fallfest.ui

import android.content.Intent
import android.provider.CalendarContract
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.qiskit.fallfest.*
import java.time.Duration
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private enum class Filter(val label: String) { All("All"), Ongoing("Ongoing"), Upcoming("Upcoming"), Saved("Saved") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HubScreen(app: AppState, onOpen: (Event) -> Unit, onNotifications: () -> Unit, onProfile: () -> Unit) {
    val now = app.now()
    val events = app.events
    val first = events.minOfOrNull { it.startDay }
    val last = events.maxOfOrNull { it.endDay }
    val days = remember(first, last) { if (first == null || last == null) emptyList() else generateSequence(first) { it.plusDays(1) }.takeWhile { !it.isAfter(last) }.take(60).toList() }
    var picked by remember { mutableStateOf<LocalDate?>(null) }
    val day = picked ?: days.firstOrNull { it == now.toLocalDate() } ?: days.firstOrNull()
    var filter by remember { mutableStateOf(Filter.All) }
    val hf = LocalHapticFeedback.current

    val shown = events.filter { e ->
        (day == null || e.coversDay(day)) && when (filter) {
            Filter.All -> true
            Filter.Ongoing -> app.statusOf(e) == Status.Live
            Filter.Upcoming -> app.statusOf(e) == Status.Upcoming
            Filter.Saved -> e.saved
        }
    }.sortedWith(compareBy({ if (day != null && e0(it, day)) 0 else 1 }, { it.start }))
    val live = events.filter { app.statusOf(it) == Status.Live }.maxByOrNull { it.start }
    val next = events.filter { app.statusOf(it) == Status.Upcoming }.minByOrNull { it.start }

    PullToRefreshBox(app.refreshing, { app.refresh() }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 130.dp)) {
            item {
                Row(Modifier.statusBarsPadding().padding(horizontal = 24.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Logo(Modifier.weight(1f))
                    Box(Modifier.size(44.dp).pressable(CircleShape, true) { onNotifications() }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.NotificationsNone, "Announcements", tint = P.ink, modifier = Modifier.size(25.dp))
                        if (app.unread) Box(Modifier.align(Alignment.TopEnd).padding(top = 9.dp, end = 10.dp).size(9.dp).clip(CircleShape).background(P.danger).border(1.5.dp, P.bg, CircleShape))
                    }
                    Spacer(Modifier.width(6.dp))
                    Box(Modifier.size(42.dp).pressable(CircleShape, true) { onProfile() }.background(P.surfaceAlt).border(1.dp, P.line, CircleShape), contentAlignment = Alignment.Center) {
                        Text(app.profile?.initials ?: "", style = T.bodyM.copy(fontWeight = FontWeight.Bold), color = P.ink)
                    }
                }
            }
            if (app.offline) item {
                Row(Modifier.padding(horizontal = 24.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(P.surfaceAlt).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Icons.Outlined.CloudOff, null, tint = P.muted, modifier = Modifier.size(18.dp)); Text("You’re offline. Showing the last saved schedule.", style = T.small, color = P.muted)
                }
                Spacer(Modifier.height(10.dp))
            }
            item {
                Column(Modifier.padding(horizontal = 24.dp).padding(top = 4.dp, bottom = 18.dp)) {
                    val h = now.hour
                    Text("${if (h < 12) "Good morning" else if (h < 17) "Good afternoon" else "Good evening"}, ${app.profile?.firstName.orEmpty()}", style = T.h1, color = P.ink)
                    Text(now.format(DateTimeFormatter.ofPattern("EEEE, d MMMM")) + (app.settings["venue"]?.let { " · $it" } ?: ""), style = T.body, color = P.muted)
                }
            }
            if (events.isEmpty()) item { EmptyState(if (app.refreshing) "Loading schedule…" else "Schedule coming soon", "Pull down to refresh.", Icons.Outlined.EventAvailable) }
            else {
                item { Hero(app, live, next, onOpen); Spacer(Modifier.height(26.dp)) }
                item {
                    if (days.size > 1) { DayTabs(days, day) { picked = it; hf.performHapticFeedback(HapticFeedbackType.SegmentTick) }; Spacer(Modifier.height(14.dp)) }
                    Row(Modifier.padding(horizontal = 24.dp).fillMaxWidth().clip(CircleShape).background(P.surfaceAlt).padding(4.dp)) {
                        Filter.entries.forEach { f ->
                            val sel = filter == f
                            val bg by animateColorAsState(if (sel) P.primary else Color.Transparent, label = "f")
                            Row(
                                Modifier.weight(1f).clip(CircleShape).clickable { filter = f; hf.performHapticFeedback(HapticFeedbackType.SegmentTick) }.background(bg).padding(vertical = 10.dp),
                                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(f.label, style = T.bodyM.copy(fontSize = 13.sp), color = if (sel) P.onPrimary else P.muted)
                                if (f == Filter.Ongoing && live != null) { Spacer(Modifier.width(2.dp)); PulseDot(if (sel) P.accent else Color(0xFF22C55E), 5.dp) }
                            }
                        }
                    }
                    Spacer(Modifier.height(18.dp))
                }
                if (shown.isEmpty()) item { EmptyState(if (filter == Filter.Saved) "Nothing saved yet" else "No events here", if (filter == Filter.Saved) "Tap the bookmark on any event to add it to your pass." else "Try a different day or filter.", if (filter == Filter.Saved) Icons.Outlined.BookmarkBorder else Icons.Outlined.EventAvailable) }
                items(shown, key = { it.id }) { e -> EventRow(e, app, day, Modifier.animateItem().padding(horizontal = 24.dp, vertical = 6.dp), onOpen) }
            }
        }
    }
}
private fun e0(e: Event, day: LocalDate) = e.isMultiDay && e.startDay.isBefore(day) // events already running float to the top of later days

@Composable
private fun Hero(app: AppState, live: Event?, next: Event?, onOpen: (Event) -> Unit) {
    val now = app.now()
    val firstStart = app.events.minOf { it.start }; val lastEnd = app.events.maxOf { it.end }
    val before = now.isBefore(firstStart); val after = now.isAfter(lastEnd)
    val target = live ?: next ?: app.events.first()
    val shape = RoundedCornerShape(30.dp)
    Box(Modifier.padding(horizontal = 24.dp).fillMaxWidth().height(206.dp).clip(shape).background(Brush.linearGradient(listOf(P.hero1, P.hero2))).pressable(shape, true) { onOpen(target) }) {
        AtomOrb(Modifier.size(250.dp).align(Alignment.CenterEnd).offset(x = 80.dp).alpha(.5f), color = Color.White, speed = 12000)
        Column(Modifier.padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.SpaceBetween) {
            Column {
                when {
                    live != null -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { PulseDot(P.accent); Text("LIVE NOW · ${live.location.uppercase()}", style = T.label, color = P.accent, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    before -> Text("FEST STARTS IN", style = T.label, color = P.accent)
                    after -> Text("THANKS FOR JOINING", style = T.label, color = P.accent)
                    else -> Text("UP NEXT · ${next?.start?.format(DateTimeFormatter.ofPattern("EEE h:mm a")).orEmpty().uppercase()}", style = T.label, color = P.accent)
                }
                Spacer(Modifier.height(10.dp))
                when {
                    before -> { val d = Duration.between(now, firstStart); Text("${d.toDays()}d ${d.toHours() % 24}h ${d.toMinutes() % 60}m", style = T.h1.copy(fontSize = 36.sp, lineHeight = 40.sp), color = Color.White)
                        Text("First up · ${target.title}", style = T.body, color = Color.White.copy(alpha = .7f), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    after -> Text("See you at\nFall Fest 2027", style = T.h1, color = Color.White)
                    else -> Text(target.title, style = T.h1.copy(fontSize = 30.sp, lineHeight = 34.sp), color = Color.White, maxLines = 2)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (before) app.settings["fest_name"] ?: "" else target.rangeLabel, style = T.small, color = Color.White.copy(alpha = .75f), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Box(Modifier.size(46.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) { Icon(Icons.AutoMirrored.Outlined.ArrowForward, "Open", tint = Color(0xFF0B1A13), modifier = Modifier.size(22.dp)) }
            }
        }
    }
}

@Composable
private fun DayTabs(days: List<LocalDate>, selected: LocalDate?, onSelect: (LocalDate) -> Unit) {
    val state = rememberLazyListState()
    // bring the selected day into view (first composition and whenever it changes)
    LaunchedEffect(selected, days) { days.indexOf(selected).takeIf { it >= 0 }?.let { state.animateScrollToItem((it - 1).coerceAtLeast(0)) } }
    LazyRow(state = state, contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        itemsIndexed(days, key = { _, d -> d.toEpochDay() }) { i, d ->
            val sel = d == selected
            val bg by animateColorAsState(if (sel) P.ink else P.surface, label = "d"); val fg by animateColorAsState(if (sel) P.bg else P.ink, label = "dfg")
            val monthStart = i == 0 || days[i - 1].month != d.month
            Column(
                Modifier.width(66.dp).clip(RoundedCornerShape(20.dp)).clickable { onSelect(d) }.background(bg).border(1.dp, if (sel) Color.Transparent else P.line, RoundedCornerShape(20.dp)).padding(vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(if (monthStart) d.month.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH).uppercase() else dayShort(d), style = T.label.copy(fontSize = 10.sp), color = fg.copy(alpha = .65f), maxLines = 1)
                Text("${d.dayOfMonth}", style = T.title.copy(fontSize = 20.sp), color = fg)
                Text(if (monthStart) dayShort(d) else "", style = T.label.copy(fontSize = 9.sp), color = fg.copy(alpha = .55f), maxLines = 1)
            }
        }
    }
}

@Composable
private fun EmptyState(title: String, sub: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Column(Modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        IconBubble(icon, 64.dp, P.mintInk, P.mint); Spacer(Modifier.height(14.dp))
        Text(title, style = T.title, color = P.ink); Text(sub, style = T.small, color = P.muted, textAlign = TextAlign.Center)
    }
}

@Composable
fun StatusBadge(status: Status, checkedIn: Boolean = false) = when {
    status == Status.Live -> Pill(if (checkedIn) "LIVE · CHECKED IN" else "LIVE", P.mint, P.mintInk, dot = true)
    checkedIn -> Pill("CHECKED IN", P.mint, P.mintInk)
    status == Status.Done -> Pill("ENDED", P.surfaceAlt, P.muted)
    else -> Pill("UPCOMING", P.surfaceAlt, P.muted)
}

@Composable
fun EventRow(e: Event, app: AppState, day: LocalDate?, modifier: Modifier = Modifier, onOpen: (Event) -> Unit, trailing: Boolean = true) {
    val status = app.statusOf(e); val hf = LocalHapticFeedback.current
    Card(modifier.fillMaxWidth(), RoundedCornerShape(24.dp), onClick = { onOpen(e) }) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            IconBubble(e.track.icon, 52.dp, if (status == Status.Live) P.mintInk else P.ink, if (status == Status.Live) P.mint else P.surfaceAlt)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (day != null) e.timeLabelOn(day) else e.start.format(DateTimeFormatter.ofPattern("d MMM, h:mm a")), style = T.small, color = P.muted)
                    StatusBadge(status, app.isCheckedIn(e))
                }
                Text(e.title, style = T.title, color = P.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.LocationOn, null, tint = P.muted, modifier = Modifier.size(14.dp))
                    Text(e.location, style = T.small, color = P.muted, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                    if (e.isMultiDay) Pill("${e.durationDays} DAYS", P.surfaceAlt, P.muted)
                    if (e.registered) Pill("REGISTERED", P.mint, P.mintInk)
                }
            }
            if (trailing) {
                val sc by animateFloatAsState(if (e.saved) 1f else 0.92f, spring(0.4f, 500f), label = "bm")
                Box(Modifier.size(44.dp).clip(CircleShape).clickable { app.toggleSaved(e); hf.performHapticFeedback(HapticFeedbackType.ContextClick) }, contentAlignment = Alignment.Center) {
                    Icon(if (e.saved) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, if (e.saved) "Remove from pass" else "Save to pass", tint = if (e.saved) (if (P.dark) P.accent else P.mintInk) else P.muted, modifier = Modifier.size(24.dp).scale(sc))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventSheet(id: String, app: AppState, onDismiss: () -> Unit) {
    val e = app.events.firstOrNull { it.id == id } ?: run { onDismiss(); return }
    val ctx = LocalContext.current; val hf = LocalHapticFeedback.current; val status = app.statusOf(e)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = P.bg, dragHandle = { BottomSheetDefaults.DragHandle(color = P.line) }) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 28.dp).navigationBarsPadding().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                IconBubble(e.track.icon, 56.dp, P.mintInk, P.mint); Spacer(Modifier.width(4.dp))
                StatusBadge(status, app.isCheckedIn(e)); Pill(e.track.label.uppercase(), P.surfaceAlt, P.muted)
            }
            Text(e.title, style = T.h1, color = P.ink)
            Card(Modifier.fillMaxWidth()) {
                InfoRow(Icons.Outlined.Event, e.dayLabel); HorizontalDivider(color = P.line)
                InfoRow(Icons.Outlined.Schedule, e.rangeLabel + " IST"); HorizontalDivider(color = P.line)
                if (e.location.isNotBlank()) { InfoRow(Icons.Outlined.LocationOn, e.location); HorizontalDivider(color = P.line) }
                if (e.speaker.isNotBlank()) InfoRow(Icons.Outlined.Person, e.speaker)
            }
            if (e.description.isNotBlank()) Text(e.description, style = T.body, color = P.muted)
            if (e.registrationRequired || e.capacity != null) {
                Card(Modifier.fillMaxWidth(), RoundedCornerShape(20.dp)) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Outlined.EventSeat, null, tint = P.muted)
                        Text(when { e.registered -> "You have a seat."; e.spotsLeft == 0 -> "This event is full."; e.spotsLeft != null -> "${e.spotsLeft} of ${e.capacity} seats left"; else -> "Registration required" }, style = T.bodyM, color = P.ink, modifier = Modifier.weight(1f))
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    if (e.registrationRequired) PrimaryButton(if (e.registered) "CANCEL REGISTRATION" else "REGISTER", enabled = e.registered || e.spotsLeft != 0 && status != Status.Done) { app.toggleRegistered(e); hf.performHapticFeedback(HapticFeedbackType.ContextClick) }
                    else PrimaryButton(if (e.saved) "SAVED TO PASS" else "ADD TO MY PASS", icon = { Icon(if (e.saved) Icons.Outlined.Check else Icons.Outlined.Add, null, tint = P.onPrimary, modifier = Modifier.size(20.dp)) }) { app.toggleSaved(e); hf.performHapticFeedback(HapticFeedbackType.ContextClick) }
                }
                Box(Modifier.size(58.dp).pressable(CircleShape, true) {
                    runCatching { ctx.startActivity(Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
                        .putExtra(CalendarContract.Events.TITLE, e.title + " · Qiskit Fall Fest").putExtra(CalendarContract.Events.EVENT_LOCATION, e.location).putExtra(CalendarContract.Events.DESCRIPTION, e.description)
                        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, e.start.toInstant().toEpochMilli()).putExtra(CalendarContract.EXTRA_EVENT_END_TIME, e.end.toInstant().toEpochMilli()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                }.background(P.surfaceAlt).border(1.dp, P.line, CircleShape), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.CalendarMonth, "Add to calendar", tint = P.ink) }
            }
        }
    }
}

@Composable
private fun InfoRow(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(Modifier.padding(horizontal = 18.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Icon(icon, null, tint = P.muted, modifier = Modifier.size(20.dp)); Text(text, style = T.bodyM.copy(fontSize = 15.sp), color = P.ink)
    }
}
