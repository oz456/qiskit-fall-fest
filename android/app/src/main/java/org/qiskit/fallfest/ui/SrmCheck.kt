package org.qiskit.fallfest.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.qiskit.fallfest.ApiException
import org.qiskit.fallfest.AppState

/** Personal-email people whose college says SRM-AP confirm once after the sign-in code: SRM-AP student, or outside student. "Outside" skips every academic and OD question. */
@Composable
fun SrmCheckScreen(app: AppState) {
    val scope = rememberCoroutineScope()
    var choice by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    fun save() {
        if (choice.isEmpty()) { error = "Choose one to continue."; return }
        loading = true; error = null
        scope.launch {
            try { app.saveSrmCheck(choice) }
            catch (x: ApiException) { error = x.message } catch (_: Exception) { error = "Can't reach the server. Check your connection." }
            finally { loading = false }
        }
    }
    Column(Modifier.fillMaxSize().background(P.bg).statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("ONE-TIME CHECK", style = T.label, color = P.muted)
        Text("Are you an SRM-AP student?", style = T.h1, color = P.ink)
        Text("You signed in with a personal email, so we want to be sure. Choose carefully: this is asked only once.", style = T.body, color = P.muted)
        listOf("srm" to ("SRM University-AP student" to "You will be asked for your registration number, semester and the other academic details."),
            "outside" to ("Outside student" to "From another college. No academic details are needed.")).forEach { (key, t) ->
            val shape = RoundedCornerShape(20.dp)
            Column(Modifier.fillMaxWidth().clip(shape).background(P.surface).border(if (choice == key) 2.dp else 1.dp, if (choice == key) P.primary else P.line, shape).pressable(shape) { choice = key; error = null }.padding(18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(t.first, style = T.title, color = P.ink); Text(t.second, style = T.small, color = P.muted)
            }
        }
        if (error != null) Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.ErrorOutline, null, tint = P.danger, modifier = Modifier.size(16.dp)); Text(error.orEmpty(), style = T.small, color = P.danger)
        }
        PrimaryButton("CONTINUE", loading = loading) { save() }
        Text("Not you? Sign out", style = T.small, color = P.muted, modifier = Modifier.align(Alignment.CenterHorizontally).pressable(RoundedCornerShape(8.dp)) { app.signOut() }.padding(10.dp))
    }
}
