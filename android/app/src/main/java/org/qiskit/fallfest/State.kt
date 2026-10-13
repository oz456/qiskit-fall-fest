package org.qiskit.fallfest

import android.content.Context
import android.os.Build
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.time.Instant
import java.time.ZonedDateTime
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val STEP_SEC = 30L

/** Single source of truth for UI. Network-first with an on-device cache so the schedule still opens offline. */
class AppState(context: Context) {
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
    var refreshing by mutableStateOf(false); private set
    var offline by mutableStateOf(false); private set
    var message by mutableStateOf<String?>(null)
    var nowMs by mutableLongStateOf(System.currentTimeMillis())
    private var seenAnnouncement by mutableStateOf(prefs.getString("seen_ann", null))

    val signedIn: Boolean get() = profile != null
    val unread: Boolean get() = announcements.firstOrNull()?.let { it.id != seenAnnouncement } == true
    val savedIds: Set<String> get() = events.filter { it.saved }.map { it.id }.toSet()
    fun now(): ZonedDateTime = Instant.ofEpochMilli(nowMs).atZone(IST)

    init {
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
        prefs.edit().putString("profile", p.toString()).apply()
        profile = Profile(p.str("name"), p.str("email"), p.strOrNull("college"), p.str("passCode"))
        refresh()
    }

    fun signOut() {
        val t = accessToken
        scope.launch { runCatching { api.call("POST", "/v1/auth/logout", null, t) } }
        wipe()
    }
    private fun wipe() {
        accessToken = null; secure.clear(); prefs.edit().clear().apply()
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
                (authed("GET", "/v1/me") as JSONObject).getJSONArray("checkins").let { a ->
                    checkins = a.mapObjects { it.str("scope") to Instant.parse(it.str("at")) }.toMap()
                }
                offline = false
                prefs.edit().putString("cache_events", ev.toString()).putString("cache_ann", announcementsJson()).apply()
            } catch (e: ApiException) { if (e.http != 401) offline = true }
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
        scope.launch { runCatching { authed(if (on) "PUT" else "DELETE", "/v1/events/${e.id}/saved") }.onFailure { patch(e.id) { it.withUser(saved = !on) }; message = "Couldn't update. Check your connection." } }
    }

    suspend fun createTicket(kind: String, topic: String, text: String): String {
        val r = authed("POST", "/v1/tickets", JSONObject().put("kind", kind).put("topic", topic).put("message", text)) as JSONObject
        loadTickets(); return r.str("code")
    }
    fun replyTicket(id: String, text: String) { scope.launch { try { authed("POST", "/v1/tickets/$id/messages", JSONObject().put("body", text)); loadTickets() } catch (x: ApiException) { message = x.message } catch (_: Exception) { message = "Couldn't send. Check your connection." } } }

    // ---------- status ----------
    fun statusOf(e: Event): Status { val n = now(); return when { n.isBefore(e.start) -> Status.Upcoming; n.isBefore(e.end) -> Status.Live; else -> Status.Done } }
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
