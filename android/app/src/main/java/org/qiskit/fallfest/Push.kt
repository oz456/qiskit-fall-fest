package org.qiskit.fallfest

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Notifications. Exactly two kinds exist, and both come from the organisers: a new announcement ("announcements" channel)
 * and a reply to the attendee's support ticket ("support" channel). Nothing else ever notifies.
 */
object Push {
    const val CH_ANN = "announcements"
    const val CH_SUPPORT = "support"
    /** Set by AppState so a push that arrives while the app is open refreshes the data immediately. */
    @Volatile var onArrived: ((type: String) -> Unit)? = null

    fun createChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_ANN, "Announcements", NotificationManager.IMPORTANCE_HIGH).apply { description = "News from the Fall Fest team" })
        nm.createNotificationChannel(NotificationChannel(CH_SUPPORT, "Support replies", NotificationManager.IMPORTANCE_HIGH).apply { description = "When the team answers your support ticket" })
    }

    /** True when the OS will actually show our notifications (permission granted on Android 13+, not switched off in settings). */
    fun enabled(ctx: Context): Boolean =
        androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

    fun show(ctx: Context, title: String, body: String, type: String, id: String?) {
        if (!enabled(ctx)) return
        createChannels(ctx)
        val open = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("type", type).apply { id?.let { putExtra("id", it) } }
        val pi = PendingIntent.getActivity(ctx, (type + id).hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(ctx, if (type == "ticket") CH_SUPPORT else CH_ANN)
            .setSmallIcon(R.drawable.ic_stat_qff).setColor(0xFF7E1322.toInt()).setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pi).build()
        ctx.getSystemService(NotificationManager::class.java).notify(if (type == "ticket") ("t" + id).hashCode() else ("a" + id).hashCode(), n)
    }
}

class FcmService : FirebaseMessagingService() {
    /** Google rotates tokens now and then; AppState re-registers the new one the next time it syncs. */
    override fun onNewToken(token: String) { getSharedPreferences("qff", MODE_PRIVATE).edit().putString("fcm_seen", token).apply(); Push.onArrived?.invoke("token") }

    // Only reached when the app is in the foreground (in the background the system shows the notification itself).
    override fun onMessageReceived(m: RemoteMessage) {
        val type = m.data["type"] ?: return
        val title = m.notification?.title ?: m.data["title"] ?: return
        Push.show(applicationContext, title, m.notification?.body ?: m.data["body"].orEmpty(), type, m.data["id"])
        Push.onArrived?.invoke(type)
    }
}
