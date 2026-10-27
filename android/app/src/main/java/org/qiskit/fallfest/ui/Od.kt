package org.qiskit.fallfest.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.qiskit.fallfest.ApiException
import org.qiskit.fallfest.AppState

/** After a door check-in at an event that collects OD details, the student gives OD from time, OD until time and the number of hours. */
@Composable
fun OdDialog(app: AppState, eventId: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val title = app.events.firstOrNull { it.id == eventId }?.title
    var from by remember { mutableStateOf("") }
    var until by remember { mutableStateOf("") }
    var hours by remember { mutableStateOf("") }
    var edited by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }

    fun mins(t: String) = t.substring(0, 2).toInt() * 60 + t.substring(3).toInt()
    fun auto() { if (!edited && from.isNotEmpty() && until.isNotEmpty()) { val m = mins(until) - mins(from); if (m > 0) hours = (Math.round(m / 15.0) / 4.0).toString().removeSuffix(".0") } }
    fun pick(onPicked: (String) -> Unit) { android.app.TimePickerDialog(ctx, { _, h, m -> onPicked("%02d:%02d".format(h, m)); auto() }, 10, 0, true).show() }
    fun save() {
        val n = hours.trim().replace(',', '.').toDoubleOrNull()
        when {
            from.isEmpty() || until.isEmpty() -> error = "Fill in both times."
            until <= from -> error = "OD until time must be after OD from time."
            n == null || n <= 0 || n > 24 -> error = "Enter the number of hours (more than 0, at most 24)."
            else -> { loading = true; error = null
                scope.launch {
                    try { app.saveOd(eventId, from, until, n) }
                    catch (x: ApiException) { error = x.message } catch (_: Exception) { error = "Can't reach the server. Check your connection." }
                    finally { loading = false }
                } }
        }
    }
    AlertDialog(
        onDismissRequest = { app.odDismissed = app.odDismissed + eventId }, containerColor = P.bg,
        title = { Text("OD details", style = T.h2, color = P.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (title != null) "You were checked in at $title. Tell us your OD times." else "You were checked in. Tell us your OD times.", style = T.body, color = P.muted)
                OdBox("OD from time", from.ifEmpty { "Choose time" }, from.isEmpty()) { pick { from = it } }
                OdBox("OD until time", until.ifEmpty { "Choose time" }, until.isEmpty()) { pick { until = it } }
                Text("Number of hours", style = T.small, color = P.muted)
                Box(Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(14.dp)).background(P.surface).border(1.dp, P.line, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp), contentAlignment = Alignment.CenterStart) {
                    if (hours.isEmpty()) Text("e.g. 2", style = T.body, color = P.muted.copy(alpha = .8f))
                    BasicTextField(hours, { hours = it.take(5); edited = true; error = null }, singleLine = true, textStyle = T.body.copy(color = P.ink), cursorBrush = SolidColor(P.primary),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                }
                if (error != null) Text(error.orEmpty(), style = T.small, color = P.danger)
            }
        },
        confirmButton = { TextButton(onClick = { save() }, enabled = !loading) { Text(if (loading) "Saving…" else "Save", color = P.primary) } },
        dismissButton = { TextButton(onClick = { app.odDismissed = app.odDismissed + eventId }) { Text("Later", color = P.muted) } },
    )
}

@Composable
private fun OdBox(label: String, value: String, placeholder: Boolean, onClick: () -> Unit) {
    Text(label, style = T.small, color = P.muted)
    Box(Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(14.dp)).background(P.surface).border(1.dp, P.line, RoundedCornerShape(14.dp)).pressable(RoundedCornerShape(14.dp)) { onClick() }.padding(horizontal = 14.dp), contentAlignment = Alignment.CenterStart) {
        Text(value, style = T.body, color = if (placeholder) P.muted.copy(alpha = .8f) else P.ink)
    }
}
