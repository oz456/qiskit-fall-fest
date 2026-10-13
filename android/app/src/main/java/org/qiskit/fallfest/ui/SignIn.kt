package org.qiskit.fallfest.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.qiskit.fallfest.ApiException
import org.qiskit.fallfest.AppState

@Composable
fun SignInScreen(app: AppState) {
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var step by remember { mutableIntStateOf(0) } // 0 = email, 1 = code
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var cooldown by remember { mutableIntStateOf(0) }
    val shake = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val hf = LocalHapticFeedback.current

    fun fail(msg: String) {
        error = msg; hf.performHapticFeedback(HapticFeedbackType.LongPress)
        scope.launch { repeat(3) { shake.animateTo(14f, tween(45)); shake.animateTo(-14f, tween(45)) }; shake.animateTo(0f, tween(45)) }
    }
    fun sendCode() {
        val e = email.trim()
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(e).matches()) return fail("Enter the email you registered with")
        focus.clearFocus(); loading = true; error = null
        scope.launch {
            try { info = app.requestCode(e); step = 1; code = ""; cooldown = 30 }
            catch (x: ApiException) { fail(x.message) } catch (_: Exception) { fail("Can't reach the server. Check your connection.") }
            finally { loading = false }
        }
    }
    fun verify(c: String) {
        if (loading) return
        loading = true; error = null
        scope.launch {
            try { app.verify(email, c) }
            catch (x: ApiException) { code = ""; fail(x.message) } catch (_: Exception) { code = ""; fail("Can't reach the server. Check your connection.") }
            finally { loading = false }
        }
    }
    LaunchedEffect(cooldown) { if (cooldown > 0) { delay(1000); cooldown-- } }

    var entered by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { entered = true }
    fun stagger(i: Int) = tween<Float>(700, 120 * i, FastOutSlowInEasing)

    Box(Modifier.fillMaxSize().background(P.bg)) {
        Box(
            Modifier.size(420.dp).align(Alignment.TopEnd).offset(110.dp, (-40).dp)
                .background(Brush.radialGradient(listOf(Color(0xFF6929C4).copy(alpha = .16f), Color.Transparent)), CircleShape)
        )

        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp),
        ) {
            val a0 by animateFloatAsState(if (entered) 1f else 0f, stagger(0), label = "a0")
            Row(Modifier.padding(top = 20.dp).alpha(a0), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                Logo(Modifier.weight(1f))
                Text("Learn\nBuild\nBelong", style = T.small.copy(fontSize = 11.sp, lineHeight = 14.sp), color = P.muted, modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.height(80.dp))
            val a1 by animateFloatAsState(if (entered) 1f else 0f, stagger(1), label = "a1")
            Column(Modifier.alpha(a1).offset { IntOffset(0, ((1 - a1) * 40).dp.roundToPx()) }) {
                Text("QISKIT\nFALL FEST ’26", style = T.hero.copy(lineHeight = 44.sp), color = P.ink)
                Spacer(Modifier.height(16.dp))
                Text("The ultimate quantum computing fest by hackers, for hackers.", style = T.body.copy(fontSize = 17.sp, lineHeight = 25.sp), color = P.muted, modifier = Modifier.widthIn(max = 300.dp))
            }
            Box(Modifier.weight(1f).fillMaxWidth().heightIn(min = 36.dp)) { AtomOrb(Modifier.size(210.dp).align(Alignment.CenterEnd).offset(x = 36.dp).alpha(.7f), speed = 14000, stroke = 1.dp) }
            val a2 by animateFloatAsState(if (entered) 1f else 0f, stagger(2), label = "a2")
            Column(Modifier.alpha(a2).offset { IntOffset(shake.value.dp.roundToPx(), ((1 - a2) * 40).dp.roundToPx()) }, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                AnimatedContent(step, label = "step", transitionSpec = { (fadeIn(tween(300)) + slideInHorizontally { it / 8 }) togetherWith fadeOut(tween(150)) }) { s ->
                    if (s == 0) Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        EmailField(email, { email = it; error = null }) { sendCode() }
                        Text("Use the email you registered with. We’ll send a 6-digit code — no password needed.", style = T.small, color = P.muted, modifier = Modifier.padding(horizontal = 6.dp))
                    } else Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Enter your code", style = T.h2, color = P.ink)
                        Text(info ?: "We sent a code to $email", style = T.small, color = P.muted)
                        CodeBoxes(code, { code = it; error = null; if (it.length == 6) verify(it) })
                    }
                }
                AnimatedVisibility(error != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(start = 6.dp)) {
                        Icon(Icons.Outlined.ErrorOutline, null, tint = P.danger, modifier = Modifier.size(16.dp)); Text(error.orEmpty(), style = T.small, color = P.danger)
                    }
                }
                Spacer(Modifier.height(4.dp))
                PrimaryButton(if (step == 0) "SEND CODE" else "VERIFY", loading = loading,
                    icon = { Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, tint = P.onPrimary, modifier = Modifier.size(20.dp)) }) { if (step == 0) sendCode() else if (code.length == 6) verify(code) else fail("Enter the 6-digit code") }
                if (step == 1) Row(Modifier.align(Alignment.CenterHorizontally), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("Change email", style = T.small, color = P.muted, modifier = Modifier.pressable(RoundedCornerShape(8.dp)) { step = 0; error = null }.padding(10.dp))
                    Text(if (cooldown > 0) "Resend in ${cooldown}s" else "Resend code", style = T.small, color = if (cooldown > 0) P.muted.copy(alpha = .5f) else P.ink,
                        modifier = Modifier.pressable(RoundedCornerShape(8.dp)) { if (cooldown == 0) sendCode() }.padding(10.dp))
                }
            }
            PartnerLine(Modifier.padding(top = 0.dp))
        }
    }
}

@Composable
private fun EmailField(value: String, onChange: (String) -> Unit, onDone: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val border by animateColorAsState(if (focused) P.primary else P.line, label = "b")
    Row(
        Modifier.fillMaxWidth().height(60.dp).clip(RoundedCornerShape(20.dp)).background(P.surface).border(if (focused) 1.6.dp else 1.dp, border, RoundedCornerShape(20.dp)).padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Outlined.MailOutline, null, tint = if (focused) P.ink else P.muted, modifier = Modifier.size(20.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text("you@example.com", style = T.body, color = P.muted.copy(alpha = .8f))
            BasicTextField(value, onChange, singleLine = true, textStyle = T.body.copy(color = P.ink), cursorBrush = SolidColor(P.primary),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { onDone() }),
                modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused })
        }
    }
}

@Composable
private fun CodeBoxes(value: String, onChange: (String) -> Unit) {
    val fr = remember { FocusRequester() }
    LaunchedEffect(Unit) { fr.requestFocus() }
    BasicTextField(
        value, { onChange(it.filter(Char::isDigit).take(6)) }, modifier = Modifier.focusRequester(fr),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), cursorBrush = SolidColor(Color.Transparent), textStyle = T.h1.copy(color = Color.Transparent),
        decorationBox = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                repeat(6) { i ->
                    val active = i == value.length
                    Box(
                        Modifier.weight(1f).height(64.dp).clip(RoundedCornerShape(16.dp)).background(P.surface).border(if (active) 1.8.dp else 1.dp, if (active) P.primary else P.line, RoundedCornerShape(16.dp)),
                        contentAlignment = Alignment.Center,
                    ) { Text(value.getOrNull(i)?.toString() ?: "", style = T.h1, color = P.ink) }
                }
            }
        },
    )
}
