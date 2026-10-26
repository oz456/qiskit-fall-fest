package org.qiskit.fallfest

import android.content.Context
import android.os.Build
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.ZonedDateTime
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val STEP_SEC = 30L

/** Single source of truth for UI. Network-first with an on-device cache so the schedule still opens offline. */
class AppState(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = context.getSharedPreferences("qff", Context.MODE_PRIVATE)
    private val secure = SecureStore(context)
    private val api = Api(BuildConfig.API_BASE) { prefs.edit().putLong("skew_ms", it).apply() }.also { it.skewMs = prefs.getLong("skew_ms", 0) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var accessToken: String? = null
    private val refreshLock = kotlinx.coroutines.sync.Mutex()

    var profile by mutableStateOf(loadProfile()); private set
    var events by mutableStateOf(emptyList<Event>()); private set
    var faqs by mutableStateOf(emptyList<Faq>()); private set
    var settings by mutableStateOf(emptyMap<String, String>()); private set
    var announcements by mutableStateOf(emptyList<Announcement>()); private set
    var tickets by mutableStateOf(emptyList<Ticket>()); private set
    var checkins by mutableStateOf(emptyMap<String, Instant>()); private set
    /** Set when door staff have just checked this attendee in; the UI shows a popup and clears it. */
    var checkinNotice by mutableStateOf<CheckinNotice?>(null)
    private var announcedCheckins: Set<String> = prefs.getStringSet("seen_checkins", emptySet()) ?: emptySet()
    var refreshing by mutableStateOf(false); private set
    var offline by mutableStateOf(false); private set
    /** First sign-in: the attendee has no selfie on file yet. Door staff compare faces, so we ask once. */
    var needsSelfie by mutableStateOf(prefs.getBoolean("needs_selfie", false)); private set
    /** First sign-in of an SRM-AP person: academic details are asked once. Other attendees are never asked. */
    var needsDetails by mutableStateOf(prefs.getBoolean("needs_details", false)); private set
    var detailsSchools by mutableStateOf(listOf("SEAS", "ESLA", "PSB", "Other")); private set
    var detailsPrograms by mutableStateOf(listOf("Other")); private set
    var message by mutableStateOf<String?>(null)
    var nowMs by mutableLongStateOf(System.currentTimeMillis())
    private var seenAnnouncement by mutableStateOf(prefs.getString("seen_ann", null))
    // Support replies: when the attendee last looked at each ticket (epoch millis of its last message). Drives the red dot on the Support tab.
    private var seenTickets by mutableStateOf(runCatching { JSONObject(prefs.getString("seen_tickets", "{}")!!).let { o -> o.keys().asSequence().associateWith { o.getLong(it) } } }.getOrDefault(emptyMap()))
    fun hasNewReply(t: Ticket): Boolean = t.messages.lastOrNull()?.let { it.fromAdmin && it.at.toEpochMilli() > (seenTickets[t.id] ?: 0L) } == true
    val newReplies: Boolean get() = tickets.any { hasNewReply(it) }
    fun markTicketSeen(id: String) {
        val last = tickets.firstOrNull { it.id == id }?.messages?.lastOrNull()?.at?.toEpochMilli() ?: return
        if (seenTickets[id] == last) return
        seenTickets = seenTickets + (id to last)
        prefs.edit().putString("seen_tickets", JSONObject(seenTickets as Map<*, *>).toString()).apply()
    }

    val signedIn: Boolean get() = profile != null
    // ---- notifications (announcements + support replies only) ----
    var notifEnabled by mutableStateOf(Push.enabled(context.applicationContext)); private set
    /** "ticket" / "announcement" when the user tapped a notification; the UI consumes it and sets it back to null. */
    var pendingOpen by mutableStateOf<String?>(null)
    /** Ask once, right after sign-in + selfie, on Android 13+ (older versions allow notifications without asking). */
    fun shouldAskNotifications(): Boolean = signedIn && !needsSelfie && !needsDetails && !prefs.getBoolean("notif_asked", false) && android.os.Build.VERSION.SDK_INT >= 33 && !Push.enabled(appContext)
    fun markNotificationsAsked() { prefs.edit().putBoolean("notif_asked", true).apply() }
    fun notificationsChanged() { notifEnabled = Push.enabled(appContext); syncPush() }
    /** Registers this phone's Firebase token with the server when notifications are allowed. Safe to call any time; it only sends when something changed. */
    fun syncPush() {
        if (!signedIn || needsSelfie || !Push.enabled(appContext)) return
        com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnSuccessListener { t ->
            if (t == prefs.getString("push_registered", null)) return@addOnSuccessListener
            scope.launch {
                try { authed("PUT", "/v1/me/push-token", JSONObject().put("token", t).put("platform", "android")); prefs.edit().putString("push_registered", t).apply() }
                catch (_: Exception) { /* retried on the next refresh */ }
            }
        }
    }
    private val greetingSeed = kotlin.random.Random.nextInt(0, 10_000)
    val greeting: String get() = Greetings[greetingSeed % Greetings.size].replace("{n}", profile?.firstName.orEmpty())
    val unread: Boolean get() = announcements.firstOrNull()?.let { it.id != seenAnnouncement } == true
    val savedIds: Set<String> get() = events.filter { it.saved }.map { it.id }.toSet()
    fun now(): ZonedDateTime = Instant.ofEpochMilli(nowMs).atZone(IST)

    init {
        Push.createChannels(appContext)
        Push.onArrived = { type -> if (type == "token") syncPush() else refresh() } // a notification arriving while the app is open updates it at once
        if (signedIn) { loadCache(); refresh() }
        scope.launch { while (true) { nowMs = System.currentTimeMillis(); delay(15_000) } }
    }

    // ---------- session ----------
    private fun loadProfile(): Profile? = prefs.getString("profile", null)?.let {
        runCatching { JSONObject(it).let { o -> Profile(o.str("name"), o.str("email"), o.strOrNull("college"), o.str("passCode")) } }.getOrNull()
    }
    private val deviceId: String get() = prefs.getString("device", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("device", it).apply() }

    suspend fun requestCode(email: String): String {
        val r = api.call("POST", "/v1/auth/request-code", JSONObject().put("email", email.trim().lowercase())) as JSONObject
        return r.str("message")
    }

    suspend fun verify(email: String, code: String) {
        val r = api.call("POST", "/v1/auth/verify", JSONObject().put("email", email.trim().lowercase()).put("code", code)
            .put("deviceId", deviceId).put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}")) as JSONObject
        accessToken = r.str("accessToken")
        secure.put("refresh", r.str("refreshToken")); secure.put("pass_secret", r.str("passSecret"))
        val p = r.getJSONObject("profile")
        // Learn whether a selfie exists BEFORE showing the app, so first sign-in goes straight to the selfie step.
        val me0 = runCatching { api.call("GET", "/v1/me", null, accessToken) as JSONObject }.getOrNull()
        needsSelfie = me0?.getJSONObject("profile")?.optBoolean("hasPhoto", true) == false
        if (me0 != null) applyDetailsState(me0)
        prefs.edit().putString("profile", p.toString()).putBoolean("needs_selfie", needsSelfie).apply()
        profile = Profile(p.str("name"), p.str("email"), p.strOrNull("college"), p.str("passCode"))
        refresh()
    }

    fun signOut() {
        val t = accessToken
        val pushToken = prefs.getString("push_registered", null)
        scope.launch {
            // stop notifications for this phone before the session ends
            if (pushToken != null) runCatching { api.call("DELETE", "/v1/me/push-token?token=" + java.net.URLEncoder.encode(pushToken, "UTF-8"), null, t) }
            runCatching { api.call("POST", "/v1/auth/logout", null, t) }
        }
        runCatching { com.google.firebase.messaging.FirebaseMessaging.getInstance().deleteToken() }
        wipe()
    }
    private fun wipe() {
        accessToken = null; secure.clear(); prefs.edit().clear().apply(); needsSelfie = false; needsDetails = false; seenTickets = emptyMap(); announcedCheckins = emptySet(); checkinNotice = null
        profile = null; events = emptyList(); announcements = emptyList(); tickets = emptyList(); checkins = emptyMap()
    }

    /** Authenticated call with one transparent refresh-and-retry on 401. */
    private suspend fun authed(method: String, path: String, body: JSONObject? = null): Any? {
        try { return api.call(method, path, body, accessToken ?: refreshToken()) }
        catch (e: ApiException) {
            if (e.http != 401) throw e
            return api.call(method, path, body, refreshToken())
        }
    }
    private suspend fun refreshToken(): String = refreshLock.withLock {
        val rt = secure.get("refresh") ?: run { wipe(); throw ApiException(401, "unauthorized", "Please sign in again.") }
        try {
            val r = api.call("POST", "/v1/auth/refresh", JSONObject().put("refreshToken", rt)) as JSONObject
            secure.put("refresh", r.str("refreshToken")); accessToken = r.str("accessToken"); accessToken!!
        } catch (e: ApiException) {
            if (e.http == 401) { wipe(); message = "You were signed out. Sign in again to continue." }
            throw e
        }
    }

    // ---------- data ----------
    fun refresh() {
        if (!signedIn || refreshing) return
        scope.launch {
            refreshing = true
            try {
                val ev = authed("GET", "/v1/events") as JSONObject
                events = ev.getJSONArray("events").mapObjects { Event.parse(it) }
                faqs = ev.getJSONArray("faqs").mapObjects { Faq(it.str("q"), it.str("a")) }
                settings = ev.getJSONObject("settings").let { s -> s.keys().asSequence().associateWith { s.str(it) } }
                announcements = (authed("GET", "/v1/announcements") as org.json.JSONArray).mapObjects { Announcement(it.str("id"), it.str("title"), it.str("body"), Instant.parse(it.str("createdAt"))) }
                loadTickets()
                (authed("GET", "/v1/me") as JSONObject).let { me ->
                    applyCheckins(me)
                    me.getJSONObject("profile").let { p -> val fresh = Profile(p.str("name"), p.str("email"), p.strOrNull("college"), p.str("passCode")); if (fresh != profile) { profile = fresh; prefs.edit().putString("profile", p.toString()).apply() } } // a name fixed by the team shows up without signing in again
                    applyDetailsState(me)
                    val missing = !me.getJSONObject("profile").optBoolean("hasPhoto", true)
                    if (missing != needsSelfie) { needsSelfie = missing; prefs.edit().putBoolean("needs_selfie", missing).apply() }
                }
                offline = false
                notifEnabled = Push.enabled(appContext); syncPush()
                prefs.edit().putString("cache_events", ev.toString()).putString("cache_ann", announcementsJson()).apply()
            } catch (e: ApiException) {
                if (e.code == "photo_required") { needsSelfie = true; prefs.edit().putBoolean("needs_selfie", true).apply() } // the server blocks the app until the selfie exists
                else if (e.http != 401) offline = true
            }
            catch (_: Exception) { offline = true }
            finally { refreshing = false }
        }
    }
    private fun announcementsJson() = org.json.JSONArray(announcements.map { JSONObject().put("id", it.id).put("title", it.title).put("body", it.body).put("createdAt", it.at.toString()) }).toString()
    private fun loadCache() = runCatching {
        prefs.getString("cache_events", null)?.let { s ->
            val ev = JSONObject(s)
            events = ev.getJSONArray("events").mapObjects { Event.parse(it) }
            faqs = ev.getJSONArray("faqs").mapObjects { Faq(it.str("q"), it.str("a")) }
            settings = ev.getJSONObject("settings").let { st -> st.keys().asSequence().associateWith { st.str(it) } }
        }
        prefs.getString("cache_ann", null)?.let { s -> announcements = org.json.JSONArray(s).mapObjects { Announcement(it.str("id"), it.str("title"), it.str("body"), Instant.parse(it.str("createdAt"))) } }
    }
    private suspend fun loadTickets() {
        tickets = (authed("GET", "/v1/tickets") as org.json.JSONArray).mapObjects { t ->
            Ticket(t.str("id"), t.str("code"), t.str("kind"), t.str("topic"), t.str("status"), Instant.parse(t.str("createdAt")),
                t.getJSONArray("messages").mapObjects { m -> TicketMsg(m.str("author") == "admin", m.str("body"), Instant.parse(m.str("at"))) })
        }
    }
    fun markAnnouncementsSeen() { seenAnnouncement = announcements.firstOrNull()?.id; prefs.edit().putString("seen_ann", seenAnnouncement).apply() }

    private fun patch(id: String, f: (Event) -> Event) { events = events.map { if (it.id == id) f(it) else it } }

    fun toggleSaved(e: Event) {
        val on = !e.saved; patch(e.id) { it.withUser(saved = on) }
        scope.launch {
            try { authed(if (on) "PUT" else "DELETE", "/v1/events/${e.id}/saved") }
            catch (x: ApiException) { patch(e.id) { it.withUser(saved = !on) }; message = x.message } // the server answered: say what it said
            catch (x: Exception) { patch(e.id) { it.withUser(saved = !on) }; android.util.Log.w("QFF", "save failed", x); message = "Couldn't save. Check your connection." }
        }
    }

    private fun applyDetailsState(me: JSONObject) {
        val need = me.getJSONObject("profile").optBoolean("needsDetails", false)
        if (need != needsDetails) { needsDetails = need; prefs.edit().putBoolean("needs_details", need).apply() }
        me.optJSONObject("detailsOptions")?.let { o ->
            o.optJSONArray("schools")?.let { a -> detailsSchools = (0 until a.length()).map { a.getString(it) } }
            o.optJSONArray("programs")?.let { a -> detailsPrograms = (0 until a.length()).map { a.getString(it) } }
        }
    }

    /** One-time academic details (SRM-AP people). Throws ApiException with a readable message; its code says which field is wrong. */
    suspend fun saveDetails(regNo: String, school: String, semester: Int, course: String, program: String, cgpa: Double?) {
        try { authed("PUT", "/v1/me/details", JSONObject().put("regNo", regNo).put("school", school).put("semester", semester).put("course", course).put("program", program).put("cgpa", cgpa ?: "NA")) }
        catch (e: ApiException) { if (e.http != 409 || e.code != "already_set") throw e }
        needsDetails = false; prefs.edit().putBoolean("needs_details", false).apply()
        refresh()
    }

    /** One-time selfie upload (JPEG). Throws ApiException with a readable message on failure. */
    suspend fun uploadSelfie(jpeg: ByteArray) {
        try { api.putJpeg("/v1/me/photo", jpeg, accessToken ?: refreshToken()) }
        catch (e: ApiException) {
            if (e.http == 409) { /* already saved on the server: nothing more to do */ }
            else if (e.http == 401) api.putJpeg("/v1/me/photo", jpeg, refreshToken())
            else throw e
        }
        needsSelfie = false; prefs.edit().putBoolean("needs_selfie", false).apply()
        refresh() // the first load was refused until the selfie existed
    }

    suspend fun createTicket(kind: String, topic: String, text: String): String {
        val r = authed("POST", "/v1/tickets", JSONObject().put("kind", kind).put("topic", topic).put("message", text)) as JSONObject
        loadTickets(); return r.str("code")
    }
    fun replyTicket(id: String, text: String) { scope.launch { try { authed("POST", "/v1/tickets/$id/messages", JSONObject().put("body", text)); loadTickets() } catch (x: ApiException) { message = x.message } catch (_: Exception) { message = "Couldn't send. Check your connection." } } }

    // ---------- status ----------
    fun statusOf(e: Event): Status { val n = now(); return when { n.isBefore(e.start) -> Status.Upcoming; n.isBefore(e.end) -> Status.Live; else -> Status.Done } }
    /** Takes the check-ins from /v1/me. A check-in we have not announced yet and that is under 15 minutes old becomes a popup (older ones are marked as seen silently). */
    private fun applyCheckins(me: JSONObject) {
        val all = me.getJSONArray("checkins").mapObjects { it.str("scope") to Instant.parse(it.str("at")) }.toMap()
        checkins = all
        val fresh = all.entries.filter { it.key !in announcedCheckins }
        if (fresh.isEmpty()) return
        announcedCheckins = announcedCheckins + fresh.map { it.key }
        prefs.edit().putStringSet("seen_checkins", announcedCheckins).apply()
        val newest = fresh.filter { Duration.between(it.value, Instant.now()).toMinutes() < 15 }.maxByOrNull { it.value } ?: return
        checkinNotice = checkinLabel(newest.key, newest.value)
    }
    fun checkinLabel(scope: String, at: Instant): CheckinNotice {
        val time = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a").withZone(IST).format(at)
        return if (scope.startsWith("event:")) CheckinNotice(events.firstOrNull { it.id == scope.removePrefix("event:") }?.title ?: "Event", time)
        else CheckinNotice("Campus entry", time)
    }
    /** Light check for a new door scan: only /v1/me. Called every few seconds while My Pass is on screen. */
    fun pollCheckins() {
        if (!signedIn || needsSelfie) return
        scope.launch { try { applyCheckins(authed("GET", "/v1/me") as JSONObject) } catch (_: Exception) { } }
    }
    fun isCheckedIn(e: Event) = "event:${e.id}" in checkins
    fun dayCheckedIn(d: java.time.LocalDate) = "day:$d" in checkins

    // ---------- rotating pass QR ----------
    private fun secretBytes(): ByteArray? = secure.get("pass_secret")?.let { android.util.Base64.decode(it, android.util.Base64.DEFAULT) }
    fun serverNowSec(): Long = (System.currentTimeMillis() + api.skewMs) / 1000
    /** Pass payload for the current 30s window; matches server `passPayload`. */
    fun passPayload(): String? {
        val p = profile ?: return null; val s = secretBytes() ?: return null
        val step = serverNowSec() / STEP_SEC
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(s, "HmacSHA256")) }.doFinal("${p.passCode}|$step".toByteArray())
        return "QFF1.${p.passCode}.$step.${android.util.Base64.encodeToString(mac, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING).take(12)}"
    }
    /** Seconds left in the current QR window, 0f..1f of the step. */
    fun passProgress(): Float = 1f - ((serverNowSec() % STEP_SEC) + 0f) / STEP_SEC
}
