package org.qiskit.fallfest

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.compose.ui.graphics.toArgb
import org.qiskit.fallfest.ui.App
import org.qiskit.fallfest.ui.QffTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val state = AppState(applicationContext)
        this.state = state
        handle(intent)
        setContent { QffTheme { App(state) } }
    }

    private var state: AppState? = null
    override fun onNewIntent(intent: android.content.Intent) { super.onNewIntent(intent); handle(intent) }
    /** Tapping a notification carries type = "ticket" | "announcement"; the app then opens Support or the announcements list. */
    private fun handle(i: android.content.Intent?) { i?.getStringExtra("type")?.takeIf { it == "ticket" || it == "announcement" }?.let { state?.pendingOpen = it; i.removeExtra("type") } }
}
