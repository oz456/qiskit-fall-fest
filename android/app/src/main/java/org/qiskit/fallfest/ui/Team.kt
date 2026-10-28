package org.qiskit.fallfest.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.qiskit.fallfest.*

private fun initials(name: String) = name.trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifEmpty { "?" }

/** "Your team" for hackathon participants: the lead on top, then teammates. The lead can rename the team unless organisers have switched that off. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamSheet(app: AppState, onDismiss: () -> Unit, onOpenEvent: (() -> Unit)?) {
    val scope = rememberCoroutineScope()
    val team = app.team
    var renaming by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf(team?.name.orEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    fun save() {
        val n = name.replace(Regex("\\s+"), " ").trim()
        when {
            n.length < 3 || n.length > 40 -> error = "A team name must be 3 to 40 characters."
            n == team?.name -> renaming = false
            else -> { saving = true; error = null
                scope.launch {
                    try { app.renameTeam(n); renaming = false }
                    catch (x: ApiException) { error = x.message } catch (_: Exception) { error = "Can't reach the server. Check your connection." }
                    finally { saving = false }
                } }
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = P.bg, dragHandle = { BottomSheetDefaults.DragHandle(color = P.line) }) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 28.dp).navigationBarsPadding().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (team == null) {
                Text("Your team", style = T.h1, color = P.ink)
                Text(if (app.teamLoaded) "You haven’t formed or joined a team yet. Create your team, or accept an invitation, on the Qiskit Fall Fest website (Learning portal, Hackathon)." else "We couldn’t load your team right now. Check your connection and try again.", style = T.body, color = P.muted)
                onOpenEvent?.let { PrimaryButton("View the Hackathon") { onDismiss(); it() } }
            } else if (renaming) {
                Text("Rename your team", style = T.h1, color = P.ink)
                Text("Everyone in the team, and the organisers, will see the new name.", style = T.body, color = P.muted)
                Box(Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(16.dp)).background(P.surface).border(1.dp, P.line, RoundedCornerShape(16.dp)).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
                    BasicTextField(name, { name = it.take(40); error = null }, singleLine = true, textStyle = T.body.copy(color = P.ink), cursorBrush = SolidColor(P.primary), modifier = Modifier.fillMaxWidth())
                }
                if (error != null) Text(error.orEmpty(), style = T.small, color = P.danger)
                PrimaryButton(if (saving) "Saving…" else "Save name", loading = saving) { save() }
                TextButton(onClick = { renaming = false; error = null }, modifier = Modifier.fillMaxWidth(), enabled = !saving) { Text("Cancel", color = P.muted) }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(team.name, style = T.h1, color = P.ink, modifier = Modifier.weight(1f), maxLines = 2)
                    if (app.canRenameTeam) TextButton(onClick = { name = team.name; error = null; renaming = true }) { Text("Rename", color = P.primary) }
                }
                Text(listOfNotNull(team.problemStatement, "${team.members.size} ${if (team.members.size == 1) "member" else "members"}").joinToString(" · "), style = T.body, color = P.muted)
                team.members.forEach { m ->
                    Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Box(Modifier.size(44.dp).clip(CircleShape).background(if (m.leader) P.primary else P.surface).border(1.dp, if (m.leader) P.primary else P.line, CircleShape), contentAlignment = Alignment.Center) {
                            Text(initials(m.name), style = T.bodyM, color = if (m.leader) P.onPrimary else P.muted)
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(m.name + if (m.you) " (you)" else "", style = T.title, color = P.ink)
                            Text(if (m.leader) "Team lead" else "Teammate", style = T.small, color = P.muted)
                        }
                    }
                }
                if (team.isLeader && !app.canRenameTeam) Text("Team names can’t be changed any more.", style = T.small, color = P.muted)
                onOpenEvent?.let { TextButton(onClick = { onDismiss(); it() }, modifier = Modifier.fillMaxWidth()) { Text("View the Hackathon", color = P.primary) } }
            }
        }
    }
}
