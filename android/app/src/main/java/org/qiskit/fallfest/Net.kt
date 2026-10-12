package org.qiskit.fallfest

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val http: Int, val code: String, override val message: String) : Exception(message)

/** Thin JSON-over-HTTPS client. Auth/refresh policy lives in AppState. */
class Api(private val base: String, private val onSkew: (Long) -> Unit = {}) {
    /** serverTime - localTime in ms, derived from response Date headers; used to keep the rotating QR in sync. */
    @Volatile var skewMs: Long = 0

    suspend fun call(method: String, path: String, body: JSONObject? = null, token: String? = null): Any? = withContext(Dispatchers.IO) {
        val c = (URL(base + path).openConnection() as HttpURLConnection)
        try {
            c.requestMethod = method
            c.connectTimeout = 10_000; c.readTimeout = 15_000
            c.setRequestProperty("Accept", "application/json")
            if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val http = c.responseCode
            c.getHeaderFieldDate("Date", 0L).takeIf { it > 0 }?.let { skewMs = it - System.currentTimeMillis(); onSkew(skewMs) }
            val text = (if (http in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (http !in 200..299) {
                val j = runCatching { JSONObject(text) }.getOrNull()
                throw ApiException(http, j?.optString("error") ?: "error", j?.optString("message")?.takeIf { it.isNotBlank() } ?: "Request failed ($http)")
            }
            if (text.isBlank()) null else org.json.JSONTokener(text).nextValue()
        } finally { c.disconnect() }
    }
}

fun JSONObject.str(k: String): String = optString(k, "")
fun JSONObject.strOrNull(k: String): String? = if (isNull(k)) null else optString(k).takeIf { it.isNotEmpty() }
fun JSONObject.intOrNull(k: String): Int? = if (isNull(k) || !has(k)) null else optInt(k)
inline fun <T> JSONArray.mapObjects(f: (JSONObject) -> T): List<T> = (0 until length()).map { f(getJSONObject(it)) }
