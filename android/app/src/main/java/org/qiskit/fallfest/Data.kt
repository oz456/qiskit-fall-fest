package org.qiskit.fallfest

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.ui.graphics.vector.ImageVector
import org.json.JSONObject
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.Locale

val IST: ZoneId = ZoneId.of("Asia/Kolkata")

enum class Track(val label: String, val icon: ImageVector) {
    Main("Main event", Icons.Outlined.RocketLaunch),
    Workshop("Workshop", Icons.Outlined.Science),
    Talk("Talk", Icons.Outlined.Mic),
    Hackathon("Hackathon", Icons.Outlined.Code),
    Social("Social", Icons.Outlined.Celebration),
    Competition("Competition", Icons.Outlined.EmojiEvents);
    companion object { fun of(s: String) = entries.firstOrNull { it.name == s } ?: Main }
}
enum class Status { Live, Upcoming, Done }

data class Event(
    val id: String, val title: String, val description: String, val track: Track, val location: String, val speaker: String,
    val start: ZonedDateTime, val end: ZonedDateTime, val capacity: Int?, val registrationRequired: Boolean,
    val spotsLeft: Int?, val saved: Boolean, val registered: Boolean, val access: String = "open",
) {
    val startDay: LocalDate get() = start.toLocalDate()
    val endDay: LocalDate get() = end.toLocalDate()
    val isMultiDay: Boolean get() = endDay.isAfter(startDay)
    val durationDays: Int get() = (endDay.toEpochDay() - startDay.toEpochDay()).toInt() + 1
    fun coversDay(d: LocalDate) = !d.isBefore(startDay) && !d.isAfter(endDay)

    /** Short time label as seen from a given day of the schedule. */
    fun timeLabelOn(d: LocalDate): String = when {
        !isMultiDay -> start.format(T12)
        d == startDay -> "From " + start.format(T12)
        d == endDay -> "Until " + end.format(T12)
        else -> "All day"
    }
    val rangeLabel: String get() = if (!isMultiDay) start.format(T12) + " – " + end.format(T12)
        else start.format(DM_T) + " → " + end.format(DM_T)
    val dayLabel: String get() = if (!isMultiDay) start.format(DATE_LONG) else start.format(DM) + " – " + end.format(DM) + " · $durationDays days"

    fun withUser(saved: Boolean = this.saved, registered: Boolean = this.registered, spots: Int? = spotsLeft) = copy(saved = saved, registered = registered, spotsLeft = spots)

    companion object {
        private val T12 = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)
        private val DM = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)
        private val DM_T = DateTimeFormatter.ofPattern("d MMM, h:mm a", Locale.ENGLISH)
        private val DATE_LONG = DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", Locale.ENGLISH)
        fun parse(o: JSONObject) = Event(
            o.str("id"), o.str("title"), o.str("description"), Track.of(o.str("track")), o.str("location"), o.str("speaker"),
            Instant.parse(o.str("startsAt")).atZone(IST), Instant.parse(o.str("endsAt")).atZone(IST),
            o.intOrNull("capacity"), o.optBoolean("registrationRequired"), o.intOrNull("spotsLeft"), o.optBoolean("saved"), o.optBoolean("registered"),
            o.optString("access", if (o.optBoolean("registrationRequired")) "prereg" else "open"),
        )
    }
}

data class Announcement(val id: String, val title: String, val body: String, val at: Instant)
data class Faq(val q: String, val a: String)
data class TicketMsg(val fromAdmin: Boolean, val body: String, val at: Instant)
data class Ticket(val id: String, val code: String, val kind: String, val topic: String, val status: String, val createdAt: Instant, val messages: List<TicketMsg>)
data class Profile(val name: String, val email: String, val college: String?, val passCode: String) {
    val initials: String get() = name.split(" ").filter { it.isNotBlank() }.take(2).map { it.first().uppercaseChar() }.joinToString("").ifBlank { "?" }
    val firstName: String get() = name.substringBefore(" ")
}

fun dayShort(d: LocalDate) = d.dayOfWeek.getDisplayName(java.time.format.TextStyle.SHORT, Locale.ENGLISH).uppercase()
