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
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect
import dev.chrisbanes.haze.hazeSource
import kotlinx.coroutines.launch
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
    // Day picker: the whole festival window (admin setting) plus every day an event touches, so no day is ever hidden.
    fun parseDay(k: String) = app.settings[k]?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    val fa = parseDay("fest_start"); val fb = parseDay("fest_end")
    val festDays = if (fa != null && fb != null && !fb.isBefore(fa)) generateSequence(fa) { it.plusDays(1) }.takeWhile { !it.isAfter(fb) }.take(31).toList() else emptyList()
    val eventDays = events.flatMap { e -> generateSequence(e.startDay) { it.plusDays(1) }.takeWhile { !it.isAfter(e.endDay) }.take(30).toList() }
    val days = remember(festDays, eventDays) { (festDays + eventDays).distinct().sorted() }
    val withEvents = remember(eventDays) { eventDays.toSet() }
    var picked by remember { mutableStateOf<LocalDate?>(null) } // null = every day
    val day = picked
    var filter by remember { mutableStateOf(Filter.All) }
    val hf = LocalHapticFeedback.current

    val shown = events.filter { e -> (day == null || e.coversDay(day)) && (filter != Filter.Saved || e.saved) }
        .sortedWith(compareBy({ if (day != null && e0(it, day)) 0 else 1 }, { it.start }))
    // With "All days" the list is grouped under a small date header.
    val entries: List<Any> = if (day != null) shown else buildList { var last: LocalDate? = null; shown.forEach { e -> if (e.startDay != last) { add(e.startDay); last = e.startDay }; add(e) } }
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
                    Text(app.greeting, style = T.h1.copy(fontSize = 25.sp, lineHeight = 30.sp), color = P.ink)
                    Text(now.format(DateTimeFormatter.ofPattern("EEEE, d MMMM")) + (app.settings["venue"]?.let { " · $it" } ?: ""), style = T.body, color = P.muted)
                }
            }
            if (events.isEmpty()) item { EmptyState(if (app.refreshing) "Loading schedule…" else "Schedule coming soon", "Pull down to refresh.", Icons.Outlined.EventAvailable) }
            else {
                item { Hero(app, live, next, onOpen); Spacer(Modifier.height(26.dp)) }
                item {
                    if (days.isNotEmpty()) { DayStrip(days, day, withEvents) { picked = it; hf.performHapticFeedback(HapticFeedbackType.SegmentTick) }; Spacer(Modifier.height(14.dp)) }
                    Row(Modifier.padding(horizontal = 24.dp).fillMaxWidth().clip(CircleShape).background(P.surfaceAlt).padding(4.dp)) {
                        listOf(Filter.All, Filter.Saved).forEach { f ->
                            val sel = filter == f
                            val bg by animateColorAsState(if (sel) P.primary else Color.Transparent, label = "f")
                            Row(
                                Modifier.weight(1f).clip(CircleShape).clickable { filter = f; hf.performHapticFeedback(HapticFeedbackType.SegmentTick) }.background(bg).padding(vertical = 10.dp),
                                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(f.label, style = T.bodyM.copy(fontSize = 13.sp), color = if (sel) P.onPrimary else P.muted)
                                if (f == Filter.Ongoing && live != null) { Spacer(Modifier.width(2.dp)); PulseDot(P.accent, 5.dp) }
                            }
                        }
                    }
                    Spacer(Modifier.height(18.dp))
                }
                if (shown.isEmpty()) item { EmptyState(if (filter == Filter.Saved) "Nothing saved yet" else "No events here", if (filter == Filter.Saved) "Tap the bookmark on any event to save it." else "Try a different day or filter.", if (filter == Filter.Saved) Icons.Outlined.BookmarkBorder else Icons.Outlined.EventAvailable) }
                items(entries, key = { if (it is Event) it.id else "h$it" }) { x ->
                    if (x is Event) EventRow(x, app, day, Modifier.animateItem().padding(horizontal = 24.dp, vertical = 6.dp), onOpen)
                    else DayHeader(x as LocalDate)
                }
                item { PartnerLine() }
            }
        }
    }
}
private fun e0(e: Event, day: LocalDate) = e.isMultiDay && e.startDay.isBefore(day) // events already running float to the top of later days

@Composable
private fun Hero(app: AppState, live: Event?, next: Event?, onOpen: (Event) -> Unit) {
    val now = app.now()
    // The festival window (admin setting) bounds the countdown and the "thanks" state, even before every session is listed.
    val festStart = app.settings["fest_start"]?.let { runCatching { java.time.LocalDate.parse(it).atStartOfDay(IST) }.getOrNull() }
    val festEnd = app.settings["fest_end"]?.let { runCatching { java.time.LocalDate.parse(it).plusDays(1).atStartOfDay(IST) }.getOrNull() }
    val firstStart = listOfNotNull(app.events.minOf { it.start }, festStart).minOf { it }
    val lastEnd = listOfNotNull(app.events.maxOf { it.end }, festEnd).maxOf { it }
    val before = now.isBefore(firstStart); val after = now.isAfter(lastEnd)
    val target = live ?: next ?: app.events.first()
    val shape = RoundedCornerShape(30.dp)
    val glass = remember { HazeState() }
    Box(Modifier.padding(horizontal = 24.dp).fillMaxWidth().heightIn(min = 226.dp).clip(shape).pressable(shape, true) { onOpen(target) }) {
      Box(Modifier.matchParentSize().hazeSource(glass).background(Brush.linearGradient(listOf(P.hero1, P.hero2)))) {
        Sun(Modifier.size(100.dp).align(Alignment.TopEnd).offset(x = 36.dp, y = (-34).dp))
        AtomOrb(Modifier.size(170.dp).align(Alignment.TopEnd).offset(x = 66.dp, y = (-58).dp).alpha(.5f), color = Color(0xFFF2E7D7), electron = Color(0xFFF2E7D7), speed = 12000)
      }
        Column(Modifier.padding(horizontal = 26.dp, vertical = 24.dp).fillMaxWidth().heightIn(min = 178.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Column {
                when {
                    live != null -> Row(Modifier.padding(end = 56.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { PulseDot(P.accent); Text("LIVE NOW · ${live.location.uppercase()}", style = T.label, color = P.accent, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    before -> Text("FEST STARTS IN", style = T.label, color = P.accent)
                    after -> Text("THANKS FOR JOINING", style = T.label, color = P.accent)
                    else -> Text("UP NEXT · ${next?.start?.format(DateTimeFormatter.ofPattern("EEE h:mm a")).orEmpty().uppercase()}", style = T.label, color = P.accent)
                }
                Spacer(Modifier.height(10.dp))
                when {
                    before -> { val d = Duration.between(now, firstStart)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CountUnit(d.toDays(), "DAYS", glass); CountUnit(d.toHours() % 24, "HRS", glass); CountUnit(d.toMinutes() % 60, "MIN", glass)
                        }
                    }
                    after -> Text("SEE YOU AT\nFALL FEST 2027", style = T.poster.copy(fontSize = 32.sp), color = Color.White)
                    else -> Text(target.title, style = T.poster.copy(fontSize = 30.sp, lineHeight = 32.sp), color = Color.White, maxLines = 2, modifier = Modifier.padding(end = 40.dp))
                }
            }
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (before) app.settings["fest_name"] ?: "" else target.rangeLabel, style = T.small, color = Color.White.copy(alpha = .75f), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Box(Modifier.size(46.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) { Icon(Icons.AutoMirrored.Outlined.ArrowForward, "Open", tint = P.ink, modifier = Modifier.size(22.dp)) }
            }
        }
    }
}

/** Frosted-glass tile: blurs the sun and gradient behind it. */
@Composable
private fun CountUnit(value: Long, label: String, glass: HazeState) {
    Column(
        Modifier.clip(RoundedCornerShape(16.dp)).hazeEffect(glass, HazeStyle(backgroundColor = P.hero1, tint = HazeTint(Color.White.copy(alpha = .16f)), blurRadius = 18.dp))
            .border(1.dp, Color.White.copy(alpha = .35f), RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("%02d".format(value), style = T.poster.copy(fontSize = 34.sp, lineHeight = 36.sp), color = Color.White)
        Text(label, style = T.label.copy(fontSize = 9.sp), color = Color(0xFFF2E7D7))
    }
}

@Composable
fun PartnerLine(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            QiskitMark(18.dp)
            Text("In partnership with IBM", style = T.small, color = P.muted)
        }
        Text("SRM UNIVERSITY AP · AMARAVATI", style = T.label.copy(fontSize = 10.sp, letterSpacing = 1.6.sp), color = P.muted)
    }
}

@Composable
private fun DayHeader(d: LocalDate) {
    Text(d.format(DateTimeFormatter.ofPattern("EEE d MMM", java.util.Locale.ENGLISH)).uppercase(), style = T.label, color = P.muted, modifier = Modifier.padding(start = 28.dp, top = 14.dp, bottom = 2.dp))
}

/** Day picker: "All" + each festival day, four visible at a time, glass arrows on both sides to slide through the rest. */
@Composable
private fun DayStrip(days: List<LocalDate>, selected: LocalDate?, withEvents: Set<LocalDate>, onSelect: (LocalDate?) -> Unit) {
    val state = rememberLazyListState(); val scope = rememberCoroutineScope()
    val items: List<LocalDate?> = listOf<LocalDate?>(null) + days
    val canLeft by remember { derivedStateOf { state.firstVisibleItemIndex > 0 } }
    val canRight by remember { derivedStateOf { state.canScrollForward } }
    LaunchedEffect(selected) { items.indexOf(selected).takeIf { it >= 0 }?.let { i -> val vis = state.layoutInfo.visibleItemsInfo; if (vis.isEmpty() || i < vis.first().index || i > vis.last().index) state.animateScrollToItem(i.coerceAtMost(items.lastIndex)) } }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val chipW = (maxWidth - 48.dp - 88.dp - 24.dp) / 4
        Row(Modifier.padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
            GlassArrow(false, canLeft) { scope.launch { state.animateScrollToItem((state.firstVisibleItemIndex - 3).coerceAtLeast(0)) } }
            LazyRow(Modifier.weight(1f).padding(horizontal = 4.dp), state = state, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                itemsIndexed(items, key = { _, d -> d?.toEpochDay() ?: -1L }) { _, d ->
                    val sel = d == selected
                    val bg by animateColorAsState(if (sel) P.ink else P.surface, label = "d"); val fg by animateColorAsState(if (sel) P.bg else P.ink, label = "dfg")
                    Column(
                        Modifier.width(chipW).height(84.dp).clip(RoundedCornerShape(18.dp)).clickable { onSelect(d) }.background(bg).border(1.dp, if (sel) Color.Transparent else P.line, RoundedCornerShape(18.dp)).padding(vertical = 10.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(if (d == null) "ALL" else dayShort(d), style = T.label.copy(fontSize = 9.sp), color = fg.copy(alpha = .6f), maxLines = 1)
                        if (d == null) Icon(Icons.Outlined.ViewAgenda, null, tint = fg, modifier = Modifier.padding(vertical = 3.dp).size(20.dp))
                        else Text("${d.dayOfMonth}", style = T.poster.copy(fontSize = 26.sp, lineHeight = 30.sp), color = fg)
                        Text(if (d == null) "DAYS" else d.month.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH).uppercase(), style = T.label.copy(fontSize = 9.sp), color = fg.copy(alpha = .6f), maxLines = 1)
                        Box(Modifier.padding(top = 4.dp).size(5.dp).clip(CircleShape).background(if (d != null && d in withEvents) P.accent else Color.Transparent))
                    }
                }
            }
            GlassArrow(true, canRight) { scope.launch { state.animateScrollToItem((state.firstVisibleItemIndex + 3).coerceAtMost(items.lastIndex)) } }
        }
    }
}

@Composable
private fun GlassArrow(right: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(36.dp).alpha(if (enabled) 1f else .35f).clip(CircleShape).background(Color.White.copy(alpha = .55f)).border(1.dp, Color.White.copy(alpha = .8f), CircleShape).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(if (right) Icons.Outlined.ChevronRight else Icons.Outlined.ChevronLeft, if (right) "Later days" else "Earlier days", tint = P.ink, modifier = Modifier.size(22.dp)) }
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

/** One event. No pills (they overflowed): time, a LIVE dot, a small tick when registered, and plain text for the rest. */
@Composable
fun EventRow(e: Event, app: AppState, day: LocalDate?, modifier: Modifier = Modifier, onOpen: (Event) -> Unit, trailing: Boolean = true) {
    val status = app.statusOf(e); val hf = LocalHapticFeedback.current
    Card(modifier.fillMaxWidth(), RoundedCornerShape(24.dp), onClick = { onOpen(e) }) {
        Row(Modifier.padding(horizontal = 18.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            IconBubble(e.track.icon, 50.dp, if (status == Status.Live) P.mintInk else P.ink, if (status == Status.Live) P.mint else P.surfaceAlt)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(if (day != null) e.timeLabelOn(day) else e.start.format(DateTimeFormatter.ofPattern("h:mm a")), style = T.small, color = P.muted, maxLines = 1)
                    when {
                        status == Status.Live -> { PulseDot(P.accent, 5.dp); Text("LIVE", style = T.label.copy(fontSize = 10.sp), color = P.accent) }
                        status == Status.Done -> Text("ENDED", style = T.label.copy(fontSize = 10.sp), color = P.muted)
                    }
                    if (e.registered) Icon(Icons.Outlined.ConfirmationNumber, "Registered", tint = P.primary, modifier = Modifier.size(15.dp))
                }
                Text(e.title, style = T.title, color = P.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("${e.location}${if (e.isMultiDay) " · ${e.durationDays} days" else ""}", style = T.small, color = P.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (trailing) {
                val sc by animateFloatAsState(if (e.saved) 1f else 0.92f, spring(0.4f, 500f), label = "bm")
                Box(Modifier.size(44.dp).clip(CircleShape).clickable { app.toggleSaved(e); hf.performHapticFeedback(HapticFeedbackType.ContextClick) }, contentAlignment = Alignment.Center) {
                    Icon(if (e.saved) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, if (e.saved) "Unsave" else "Save", tint = if (e.saved) P.mintInk else P.muted, modifier = Modifier.size(24.dp).scale(sc))
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
            AccessCard(e)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    PrimaryButton(if (e.saved) "SAVED" else "SAVE IT", icon = { Icon(if (e.saved) Icons.Outlined.Check else Icons.Outlined.Add, null, tint = P.onPrimary, modifier = Modifier.size(20.dp)) }) { app.toggleSaved(e); hf.performHapticFeedback(HapticFeedbackType.ContextClick) }
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

/** How you get in: open to all, on-spot registration, or admin-managed pre-registration (enrolled = paid / approved). */
@Composable
private fun AccessCard(e: Event) {
    val a = when {
        e.registered -> Access(Icons.Outlined.CheckCircle, "You’re enrolled", "Your entry is confirmed. Show your pass at the door.", true)
        e.access == "prereg" -> Access(Icons.Outlined.Lock, "Pre-registration required", "Only enrolled attendees can enter. If you paid and don’t see “Enrolled”, contact Support.", false)
        e.access == "onspot" -> Access(Icons.Outlined.HowToReg, "On-spot registration", "Register at the venue desk when you arrive.", false)
        else -> Access(Icons.Outlined.LockOpen, "Open to everyone", "No registration needed. Just walk in.", false)
    }
    val seats = if (e.capacity != null) (if (e.spotsLeft == 0) " · Full" else if (e.spotsLeft != null) " · ${e.spotsLeft} of ${e.capacity} seats left" else "") else ""
    Card(Modifier.fillMaxWidth(), RoundedCornerShape(20.dp)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            IconBubble(a.icon, 44.dp, if (a.good) P.mintInk else P.muted, if (a.good) P.mint else P.surfaceAlt)
            Column { Text(a.title + seats, style = T.title, color = P.ink); Text(a.sub, style = T.small, color = P.muted) }
        }
    }
}

private class Access(val icon: androidx.compose.ui.graphics.vector.ImageVector, val title: String, val sub: String, val good: Boolean)

@Composable
private fun InfoRow(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(Modifier.padding(horizontal = 18.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Icon(icon, null, tint = P.muted, modifier = Modifier.size(20.dp)); Text(text, style = T.bodyM.copy(fontSize = 15.sp), color = P.ink)
    }
}
