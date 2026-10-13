package org.qiskit.fallfest.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.launch
import org.qiskit.fallfest.ApiException
import org.qiskit.fallfest.AppState
import java.io.ByteArrayOutputStream

/** First sign-in only: one selfie so door staff can match the face to the pass. */
@Composable
fun SelfieScreen(app: AppState) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val hf = LocalHapticFeedback.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var asked by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; asked = true }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }

    var capture by remember { mutableStateOf<ImageCapture?>(null) }
    var photo by remember { mutableStateOf<Bitmap?>(null) }
    var jpeg by remember { mutableStateOf<ByteArray?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 28.dp).padding(top = 28.dp, bottom = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("ONE-TIME SETUP", style = T.label, color = P.muted)
            Text("Take a quick selfie", style = T.h1.copy(fontSize = 30.sp, lineHeight = 34.sp), color = P.ink)
            Text("Door volunteers match your face to your pass. It’s saved once and only event staff can see it.", style = T.body, color = P.muted)
        }
        Spacer(Modifier.weight(1f))

        val shape = RoundedCornerShape(36.dp)
        Box(Modifier.fillMaxWidth(0.84f).aspectRatio(3f / 4f).clip(shape).background(P.surfaceAlt).border(1.dp, P.line, shape), contentAlignment = Alignment.Center) {
            val shown = photo
            when {
                shown != null -> androidx.compose.foundation.Image(shown.asImageBitmap(), "Your selfie", Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                granted -> {
                    CameraPreview({ capture = it }, Modifier.fillMaxSize())
                    Box(Modifier.fillMaxWidth(0.62f).aspectRatio(0.78f).border(2.dp, Color.White.copy(alpha = .7f), RoundedCornerShape(percent = 50)))
                }
                else -> Column(Modifier.padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    IconBubble(Icons.Outlined.CameraAlt, 56.dp, P.mintInk, P.mint)
                    Text("Camera access needed", style = T.title, color = P.ink)
                    Text("Allow the camera to take your selfie.", style = T.small, color = P.muted, textAlign = TextAlign.Center)
                }
            }
        }
        Spacer(Modifier.weight(1f))

        error?.let { Text(it, style = T.small, color = P.danger, textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 10.dp)) }

        when {
            photo != null -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.height(58.dp).weight(1f).pressable(CircleShape) { photo = null; jpeg = null; error = null }.background(P.surfaceAlt), contentAlignment = Alignment.Center) { Text("RETAKE", style = T.button, color = P.ink) }
                PrimaryButton("USE PHOTO", Modifier.weight(1.4f), loading = uploading) {
                    val bytes = jpeg ?: return@PrimaryButton
                    uploading = true; error = null
                    scope.launch {
                        try { app.uploadSelfie(bytes) }
                        catch (x: ApiException) { error = x.message } catch (_: Exception) { error = "Couldn’t upload. Check your connection and try again." }
                        finally { uploading = false }
                    }
                }
            }
            granted -> Box(Modifier.size(78.dp).clip(CircleShape).border(4.dp, P.primary, CircleShape).padding(7.dp).clip(CircleShape).background(P.primary)
                .clickable(enabled = capture != null) {
                    hf.performHapticFeedback(HapticFeedbackType.ContextClick)
                    capture?.takePicture(ContextCompat.getMainExecutor(ctx), object : ImageCapture.OnImageCapturedCallback() {
                        override fun onCaptureSuccess(image: ImageProxy) {
                            val out = runCatching { portrait(image.toBitmap(), image.imageInfo.rotationDegrees) }.getOrNull()
                            image.close()
                            if (out != null) { photo = out.first; jpeg = out.second; error = null } else error = "That didn’t work. Try again."
                        }
                        override fun onError(exception: ImageCaptureException) { error = "Couldn’t take the photo. Try again." }
                    })
                })
            else -> {
                val denied = asked
                PrimaryButton(if (denied) "OPEN SETTINGS" else "ALLOW CAMERA") {
                    if (denied) ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null)))
                    else ask.launch(Manifest.permission.CAMERA)
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Text("Not now", style = T.small, color = P.muted, modifier = Modifier.pressable(RoundedCornerShape(10.dp)) { app.skippedSelfie = true }.padding(horizontal = 16.dp, vertical = 10.dp))
    }
}

@Composable
private fun CameraPreview(onReady: (ImageCapture) -> Unit, modifier: Modifier) {
    val owner = LocalLifecycleOwner.current
    AndroidView(modifier = modifier, factory = { c ->
        PreviewView(c).apply { scaleType = PreviewView.ScaleType.FILL_CENTER; implementationMode = PreviewView.ImplementationMode.COMPATIBLE }.also { pv ->
            val future = ProcessCameraProvider.getInstance(c)
            future.addListener({
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.surfaceProvider = pv.surfaceProvider }
                val ic = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()
                provider.unbindAll()
                try { provider.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, preview, ic) }
                catch (_: Exception) { runCatching { provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, ic) } }
                onReady(ic)
            }, ContextCompat.getMainExecutor(c))
        }
    })
}

/** Upright, mirrored like the preview the person approved, cropped to 3:4 and shrunk to ~720×960 JPEG (well under the 400 KB server limit). */
private fun portrait(src: Bitmap, rotation: Int): Pair<Bitmap, ByteArray> {
    val m = Matrix().apply { postRotate(rotation.toFloat()); postScale(-1f, 1f) }
    val upright = Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
    val targetW = minOf(upright.width, upright.height * 3 / 4); val targetH = targetW * 4 / 3
    val cropped = Bitmap.createBitmap(upright, (upright.width - targetW) / 2, (upright.height - targetH) / 2, targetW, targetH)
    val scaled = if (targetW > 720) Bitmap.createScaledBitmap(cropped, 720, 960, true) else cropped
    val out = ByteArrayOutputStream(); scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)
    return scaled to out.toByteArray()
}
