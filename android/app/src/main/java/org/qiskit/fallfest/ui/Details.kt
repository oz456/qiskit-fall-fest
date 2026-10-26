package org.qiskit.fallfest.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.qiskit.fallfest.ApiException
import org.qiskit.fallfest.AppState

/** First sign-in of an SRM-AP person: academic details, asked once. */
@Composable
fun DetailsScreen(app: AppState) {
    var regNo by remember { mutableStateOf("") }
    var school by remember { mutableStateOf("") }
    var semester by remember { mutableStateOf("") }
    var program by remember { mutableStateOf("") }
    var course by remember { mutableStateOf("") }
    var cgpa by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun save() {
        val g = cgpa.trim().toDoubleOrNull()
        when {
            regNo.isBlank() -> error = "Enter your registration number, like AP25110010123."
            school.isEmpty() -> error = "Choose your school."
            semester.isEmpty() -> error = "Choose your semester."
            program.isEmpty() -> error = "Choose your program."
            course.trim().length < 2 -> error = "Enter your course, like CSE."
            g == null || g < 0 || g > 10 -> error = "Enter your CGPA as a number from 0 to 10."
            else -> {
                loading = true; error = null
                scope.launch {
                    try { app.saveDetails(regNo.trim().uppercase(), school, semester.toInt(), course.trim(), program, g) }
                    catch (x: ApiException) { error = x.message } catch (_: Exception) { error = "Can't reach the server. Check your connection." }
                    finally { loading = false }
                }
            }
        }
    }

    Column(Modifier.fillMaxSize().background(P.bg).statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionLabel("One-time setup")
        Text("Tell us about yourself", style = T.h1, color = P.ink)
        Text("We only ask this once. It helps the organisers with attendance and certificates.", style = T.body, color = P.muted)
        Spacer(Modifier.height(4.dp))
        DetailField("Registration number", regNo, { regNo = it.uppercase().take(15); error = null }, "AP25110010123", capitalize = true)
        DetailPicker("School", school, app.detailsSchools, "Choose your school") { school = it; error = null }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.weight(1f)) { DetailPicker("Semester", semester, (1..8).map { it.toString() }, "Semester") { semester = it; error = null } }
            Box(Modifier.weight(1f)) { DetailPicker("Program", program, app.detailsPrograms, "Program") { program = it; error = null } }
        }
        DetailField("Course", course, { course = it.take(60); error = null }, "e.g. CSE, ECE, Data Science")
        DetailField("CGPA", cgpa, { cgpa = it.take(5); error = null }, "e.g. 8.45", number = true)
        if (error != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Outlined.ErrorOutline, null, tint = P.danger, modifier = Modifier.size(16.dp)); Text(error.orEmpty(), style = T.small, color = P.danger)
        }
        PrimaryButton("CONTINUE", loading = loading) { save() }
        Text("Not you? Sign out", style = T.small, color = P.muted, modifier = Modifier.align(Alignment.CenterHorizontally).pressable(RoundedCornerShape(8.dp)) { app.signOut() }.padding(10.dp))
    }
}

@Composable
private fun DetailField(label: String, value: String, onChange: (String) -> Unit, hint: String, number: Boolean = false, capitalize: Boolean = false) {
    var focused by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = T.small, color = P.muted)
        Box(Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(18.dp)).background(P.surface).border(if (focused) 1.6.dp else 1.dp, if (focused) P.primary else P.line, RoundedCornerShape(18.dp)).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text(hint, style = T.body, color = P.muted.copy(alpha = .8f))
            BasicTextField(value, onChange, singleLine = true, textStyle = T.body.copy(color = P.ink), cursorBrush = SolidColor(P.primary),
                keyboardOptions = KeyboardOptions(keyboardType = if (number) KeyboardType.Decimal else KeyboardType.Text, capitalization = if (capitalize) KeyboardCapitalization.Characters else KeyboardCapitalization.None),
                modifier = Modifier.fillMaxWidth().onFocusChangedCompat { focused = it })
        }
    }
}

@Composable
private fun DetailPicker(label: String, value: String, options: List<String>, placeholder: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = T.small, color = P.muted)
        Box {
            Row(Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(18.dp)).background(P.surface).border(1.dp, P.line, RoundedCornerShape(18.dp)).pressable(RoundedCornerShape(18.dp)) { open = true }.padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(value.ifEmpty { placeholder }, style = T.body, color = if (value.isEmpty()) P.muted.copy(alpha = .8f) else P.ink)
                Icon(Icons.Outlined.ExpandMore, null, tint = P.muted, modifier = Modifier.size(20.dp))
            }
            DropdownMenu(open, { open = false }) { options.forEach { o -> DropdownMenuItem(text = { Text(o, style = T.body, color = P.ink) }, onClick = { onPick(o); open = false }) } }
        }
    }
}

private fun Modifier.onFocusChangedCompat(f: (Boolean) -> Unit): Modifier = this.then(Modifier.onFocusChanged { f(it.isFocused) })
