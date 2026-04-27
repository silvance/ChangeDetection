package com.tscm.changedetection.pairing

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Tiny PixelSentinel /api/v1 client used by the phone client to send
 * Evidence Packs to a paired desktop and to test the pairing.
 *
 * Uses HttpURLConnection on purpose: the Evidence Pack is binary and
 * we don't want to add OkHttp / Retrofit just for two endpoints.
 */
object PixelSentinelClient {

    /** Result of GET /api/v1/info — used by the Settings "test connection" button. */
    data class ServerInfo(
        val name: String,
        val version: String
    )

    /** Result of POST /api/v1/import/pack on success. */
    data class ImportResult(
        val caseId: String,
        val scanId: String
    )

    /**
     * Hit GET /api/v1/info on the paired desktop. Used to verify that
     * the host is reachable and is actually a PixelSentinel instance,
     * not some other service that happens to answer on that port.
     */
    suspend fun fetchInfo(host: String): Result<ServerInfo> = withContext(Dispatchers.IO) {
        runCatching {
            val conn = openConnection("$host/api/v1/info", method = "GET", token = null)
            try {
                val code = conn.responseCode
                if (code !in 200..299) {
                    throw IOException("HTTP $code")
                }
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(body)
                ServerInfo(
                    name = json.optString("name"),
                    version = json.optString("version")
                )
            } finally {
                conn.disconnect()
            }
        }
    }

    /**
     * Upload an Evidence Pack zip to POST /api/v1/import/pack.
     *
     * @param caseId optional — when null, the desktop auto-creates a case.
     */
    suspend fun importPack(
        host: String,
        token: String,
        packBytes: ByteArray,
        caseId: String? = null
    ): Result<ImportResult> = withContext(Dispatchers.IO) {
        runCatching {
            val urlStr = buildString {
                append(host)
                append("/api/v1/import/pack")
                if (!caseId.isNullOrBlank()) append("?caseId=").append(caseId)
            }
            val conn = openConnection(urlStr, method = "POST", token = token).apply {
                doOutput = true
                setRequestProperty("Content-Type", "application/zip")
                setRequestProperty("Content-Length", packBytes.size.toString())
            }
            try {
                conn.outputStream.use { it.write(packBytes) }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                if (code !in 200..299) {
                    throw IOException("HTTP $code: $body")
                }
                val json = JSONObject(body)
                val scanObj = json.optJSONObject("scan")
                ImportResult(
                    caseId = json.optString("caseId"),
                    scanId = scanObj?.optString("id").orEmpty()
                )
            } finally {
                conn.disconnect()
            }
        }
    }

    private fun openConnection(url: String, method: String, token: String?): HttpURLConnection {
        require(url.startsWith("http://") || url.startsWith("https://")) {
            "Host must include http:// or https:// prefix"
        }
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 5_000
            readTimeout = 60_000
            useCaches = false
            instanceFollowRedirects = false
        }
        if (!token.isNullOrEmpty()) {
            conn.setRequestProperty("X-PixelSentinel-Token", token)
        }
        return conn
    }
}
