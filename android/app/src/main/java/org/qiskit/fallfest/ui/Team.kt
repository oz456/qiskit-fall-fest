package org.qiskit.fallfest.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.qiskit.fallfest.*

private fun initials(name: String) = name.trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifEmpty { "?" }

/** "Your team" for hackathon participants: the lead on top, then teammates (view only). At the naming time the lead taps "Get my team name". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamSheet(app: AppState, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val team = app.team
    val naming = app.teamNaming
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    // keep the sheet current while the naming time comes and the names go out
    LaunchedEffect(Unit) { while (true) { delay(3000); if (!busy) app.loadTeam() } }
    fun assign() {
        busy = true; error = null
        scope.launch {
            try { app.assignTeamName() }
            catch (x: ApiException) { error = x.message } catch (_: Exception) { error = "Can't reach the server. Check your connection." }
            finally { busy = false }
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = P.bg, dragHandle = { BottomSheetDefaults.DragHandle(color = P.line) }) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 28.dp).navigationBarsPadding().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (team == null) {
                Text("Your team", style = T.h1, color = P.ink)
                Text(if (app.teamLoaded) "You haven’t formed or joined a team yet. Create your team, or accept an invitation, on the Qiskit Fall Fest website (Learning portal, Hackathon)." else "We couldn’t load your team right now. Check your connection and try again.", style = T.body, color = P.muted)
            } else {
                Text(team.name, style = T.h1, color = P.ink, maxLines = 2, modifier = if (team.nameHidden) Modifier.blur(10.dp) else Modifier)
                Text(listOfNotNull(team.founder?.let { "Inspired by $it" }, team.problemStatement, "${team.members.size} ${if (team.members.size == 1) "member" else "members"}").joinToString(" · "), style = T.body, color = P.muted)
                naming?.note?.let { Text(it, style = T.body, color = P.ink) }
                if (naming?.canAssign == true) PrimaryButton(if (busy) "Getting your name…" else "Get my team name", loading = busy) { assign() }
                if (naming?.canPractice == true) {
                    TextButton(onClick = { busy = true; error = null; scope.launch { try { app.practiceTeamNames() } catch (x: ApiException) { error = x.message } catch (_: Exception) { error = "Can't reach the server. Check your connection." } finally { busy = false } } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Practice the naming round (test teams only)", color = P.primary) }
                }
                if (error != null) Text(error.orEmpty(), style = T.small, color = P.danger)
                if (team.founder == null && naming?.note == null) Text("Team names are inspired by India’s founders.", style = T.small, color = P.muted)
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
            }
        }
    }
}
