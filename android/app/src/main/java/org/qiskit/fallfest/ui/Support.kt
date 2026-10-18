package org.qiskit.fallfest.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForwardIos
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.qiskit.fallfest.*
import java.time.ZoneId
import java.time.format.DateTimeFormatter

sealed interface SheetKind {
    data object None : SheetKind; data object Faq : SheetKind
    data class Form(val kind: String) : SheetKind
    data class Thread(val id: String) : SheetKind
}
private val STAMP = DateTimeFormatter.ofPattern("d MMM, h:mm a").withZone(IST)

@Composable
fun SupportScreen(app: AppState, open: (SheetKind) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 130.dp)) {
        item {
            Column(Modifier.statusBarsPadding().padding(horizontal = 24.dp, vertical = 18.dp)) {
                Text("SUPPORT & GRIEVANCES", style = T.label, color = P.muted)
                PosterTitle("WE’VE GOT", "YOUR BACK.")
            }
        }
        item {
            Card(Modifier.padding(horizontal = 24.dp).fillMaxWidth(), onClick = { open(SheetKind.Form("General")) }) {
                Row(Modifier.padding(22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    IconBubble(Icons.Outlined.SupportAgent, 54.dp, P.mintInk, P.mint)
                    Column(Modifier.weight(1f)) {
                        Text("Need help?", style = T.title, color = P.ink)
                        Text(app.settings["support_note"] ?: "Reach our support team or raise a grievance.", style = T.small, color = P.muted)
                    }
                    Chevron()
                }
            }
            Spacer(Modifier.height(14.dp))
            Card(Modifier.padding(horizontal = 24.dp).fillMaxWidth()) {
              Column(Modifier.padding(horizontal = 18.dp)) {
                Option(Icons.Outlined.Groups, "Request mentor help", "Stuck on your quantum circuit? Ping an expert.") { open(SheetKind.Form("Mentor help")) }
                Option(Icons.Outlined.WarningAmber, "Submit a grievance", "Report an issue, bug, or team dispute.") { open(SheetKind.Form("Grievance")) }
                Option(Icons.AutoMirrored.Outlined.MenuBook, "FAQs & rules", "Hackathon guidelines.", last = true) { open(SheetKind.Faq) }
              }
            }
            Spacer(Modifier.height(20.dp))
            Box(Modifier.padding(horizontal = 24.dp)) {
                Row(Modifier.fillMaxWidth().height(58.dp).pressable(CircleShape, true) { open(SheetKind.Form("General")) }.background(P.mint), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.ConfirmationNumber, null, tint = P.mintInk, modifier = Modifier.size(22.dp)); Spacer(Modifier.width(10.dp)); Text("NEW SUPPORT TICKET", style = T.button, color = P.mintInk)
                }
            }
        }
        if (app.tickets.isNotEmpty()) {
            item { SectionLabel("YOUR TICKETS", Modifier.padding(start = 24.dp, top = 30.dp, bottom = 8.dp)) }
            items(app.tickets, key = { it.id }) { t ->
                val replied = t.messages.lastOrNull()?.fromAdmin == true
                Card(Modifier.animateItem().padding(horizontal = 24.dp, vertical = 5.dp).fillMaxWidth(), RoundedCornerShape(20.dp), onClick = { open(SheetKind.Thread(t.id)) }) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(t.code, style = T.bodyM, color = P.ink)
                            when { t.status == "resolved" -> Pill("RESOLVED", P.mint, P.mintInk); replied -> Pill("NEW REPLY", P.primary, P.onPrimary); else -> Pill(t.status.replace('_', ' ').uppercase(), P.surfaceAlt, P.muted) }
                            Spacer(Modifier.weight(1f)); Text(STAMP.format(t.createdAt), style = T.small, color = P.muted)
                        }
                        Text("${t.kind} · ${t.topic}", style = T.title.copy(fontSize = 15.sp), color = P.ink)
                        t.messages.lastOrNull()?.let { Text((if (it.fromAdmin) "Team: " else "You: ") + it.body, style = T.small, color = P.muted, maxLines = 2) }
                    }
                }
            }
        }
    }
}

@Composable private fun Chevron() = Icon(Icons.AutoMirrored.Outlined.ArrowForwardIos, null, tint = P.muted, modifier = Modifier.size(15.dp))

@Composable
private fun Option(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, sub: String, last: Boolean = false, onClick: () -> Unit) {
    Column {
        Row(Modifier.fillMaxWidth().pressable(RoundedCornerShape(16.dp), onClick = onClick).padding(vertical = 16.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            IconBubble(icon, 50.dp)
            Column(Modifier.weight(1f)) { Text(title, style = T.title, color = P.ink); Text(sub, style = T.small, color = P.muted) }
            Chevron()
        }
        if (!last) HorizontalDivider(color = P.line)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SupportSheet(kind: SheetKind, app: AppState, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = P.bg, dragHandle = { BottomSheetDefaults.DragHandle(color = P.line) }) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding().imePadding().verticalScroll(rememberScrollState())) {
            when (kind) {
                SheetKind.Faq -> Faqs(app)
                is SheetKind.Form -> TicketForm(kind.kind, app, onDismiss)
                is SheetKind.Thread -> ThreadView(kind.id, app)
                SheetKind.None -> {}
            }
        }
    }
}

@Composable
private fun ThreadView(id: String, app: AppState) {
    val t = app.tickets.firstOrNull { it.id == id } ?: return
    var text by remember { mutableStateOf("") }
    Text(t.code, style = T.h1, color = P.ink)
    Text("${t.kind} · ${t.topic} · ${t.status.replace('_', ' ')}", style = T.small, color = P.muted, modifier = Modifier.padding(bottom = 14.dp))
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        t.messages.forEach { m ->
            Column(Modifier.align(if (m.fromAdmin) Alignment.Start else Alignment.End).widthIn(max = 300.dp).clip(RoundedCornerShape(18.dp)).background(if (m.fromAdmin) P.mint else P.surface).border(1.dp, P.line, RoundedCornerShape(18.dp)).padding(14.dp)) {
                Text(m.body, style = T.body, color = if (m.fromAdmin) P.mintInk else P.ink)
                Text((if (m.fromAdmin) "Fall Fest team · " else "") + STAMP.format(m.at), style = T.small.copy(fontSize = 11.sp), color = P.muted)
            }
        }
    }
    Spacer(Modifier.height(16.dp))
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(P.surface).border(1.dp, P.line, RoundedCornerShape(20.dp)).padding(16.dp)) {
        if (text.isEmpty()) Text("Write a reply…", style = T.body, color = P.muted.copy(alpha = .8f))
        BasicTextField(text, { text = it.take(2000) }, textStyle = T.body.copy(color = P.ink), cursorBrush = SolidColor(P.primary), modifier = Modifier.fillMaxWidth())
    }
    Spacer(Modifier.height(12.dp))
    PrimaryButton("SEND REPLY", enabled = text.isNotBlank()) { app.replyTicket(id, text.trim()); text = "" }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TicketForm(initial: String, app: AppState, onDone: () -> Unit) {
    var kind by remember { mutableStateOf(initial) }
    val topics = when (kind) {
        "Mentor help" -> listOf("Circuits", "Algorithms", "IBM Quantum / hardware", "Setup & Git")
        "Grievance" -> listOf("Facilities", "Team dispute", "Conduct", "Other")
        else -> listOf("Pass / check-in", "Schedule", "Wi-Fi & power", "Other")
    }
    var topic by remember(kind) { mutableStateOf(topics.first()) }
    var msg by remember { mutableStateOf("") }
    var done by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    val hf = LocalHapticFeedback.current; val scope = rememberCoroutineScope()

    AnimatedContent(done, label = "ticket") { code ->
        if (code != null) {
            Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                var go by remember { mutableStateOf(false) }; LaunchedEffect(Unit) { go = true }
                val s by animateFloatAsState(if (go) 1f else 0f, spring(0.45f, 250f), label = "ok")
                Box(Modifier.size(84.dp).graphicsLayer { scaleX = s; scaleY = s }.clip(CircleShape).background(P.mint), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Check, null, tint = P.mintInk, modifier = Modifier.size(44.dp)) }
                Text("Ticket raised", style = T.h1, color = P.ink); Text(code, style = T.title, color = P.mintInk)
                Text("A volunteer will reply here and by email. Track it under Your tickets.", style = T.body, color = P.muted, textAlign = TextAlign.Center)
                Spacer(Modifier.height(10.dp)); PrimaryButton("DONE", onClick = onDone)
            }
        } else Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(when (kind) { "Mentor help" -> "Request mentor help"; "Grievance" -> "Submit a grievance"; else -> "New support ticket" }, style = T.h1, color = P.ink)
            SectionLabel("TYPE")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { listOf("General", "Mentor help", "Grievance").forEach { Chip(it, kind == it) { kind = it } } }
            SectionLabel("TOPIC")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { topics.forEach { Chip(it, topic == it) { topic = it } } }
            SectionLabel("DETAILS")
            Box(Modifier.fillMaxWidth().heightIn(min = 120.dp).clip(RoundedCornerShape(20.dp)).background(P.surface).border(1.dp, P.line, RoundedCornerShape(20.dp)).padding(18.dp)) {
                if (msg.isEmpty()) Text("Describe what’s going on, and where to find you.", style = T.body, color = P.muted.copy(alpha = .8f))
                BasicTextField(msg, { msg = it.take(2000) }, textStyle = T.body.copy(color = P.ink), cursorBrush = SolidColor(P.primary), modifier = Modifier.fillMaxWidth())
            }
            err?.let { Text(it, style = T.small, color = P.danger) }
            PrimaryButton("SUBMIT", loading = busy, enabled = msg.trim().length >= 5) {
                busy = true; err = null
                scope.launch {
                    try { done = app.createTicket(kind, topic, msg.trim()); hf.performHapticFeedback(HapticFeedbackType.Confirm) }
                    catch (x: ApiException) { err = x.message } catch (_: Exception) { err = "Couldn't send. Check your connection and try again." }
                    finally { busy = false }
                }
            }
        }
    }
}

@Composable
private fun Chip(text: String, sel: Boolean, onClick: () -> Unit) {
    val bg by animateColorAsState(if (sel) P.primary else P.surface, label = "c")
    Text(text, style = T.bodyM.copy(fontSize = 13.sp), color = if (sel) P.onPrimary else P.ink,
        modifier = Modifier.clip(CircleShape).clickable(onClick = onClick).background(bg).border(1.dp, if (sel) Color.Transparent else P.line, CircleShape).padding(horizontal = 16.dp, vertical = 10.dp))
}

@Composable
private fun Faqs(app: AppState) {
    var open by remember { mutableIntStateOf(-1) }
    Text("FAQs & rules", style = T.h1, color = P.ink, modifier = Modifier.padding(bottom = 12.dp))
    if (app.faqs.isEmpty()) Text("No FAQs yet.", style = T.body, color = P.muted)
    app.faqs.forEachIndexed { i, f ->
        val expanded = open == i; val rot by animateFloatAsState(if (expanded) 90f else 0f, label = "r")
        Column(Modifier.clickable { open = if (expanded) -1 else i }.animateContentSize().padding(vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text(f.q, style = T.title, color = P.ink, modifier = Modifier.weight(1f)); Icon(Icons.AutoMirrored.Outlined.ArrowForwardIos, null, tint = P.muted, modifier = Modifier.size(14.dp).rotate(rot)) }
            if (expanded) Text(f.a, style = T.body, color = P.muted, modifier = Modifier.padding(top = 8.dp))
        }
        HorizontalDivider(color = P.line)
    }
}
