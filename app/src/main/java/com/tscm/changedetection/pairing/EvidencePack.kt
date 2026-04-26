package com.tscm.changedetection.pairing

import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Pure-Kotlin builder for the PixelSentinel "Evidence Pack v1" zip format.
 *
 *  The same format is consumed by:
 *   - The desktop server at POST /api/v1/import/pack
 *   - Any future desktop tool that knows how to open a zip with a manifest.
 *
 *  The same zip is also what the existing Android share-sheet export
 *  produces, so this builder is the single source of truth on the phone.
 */
object EvidencePack {

    /** Analysis settings that produced [Stats] / the result image. */
    data class Params(
        val strength: Int,
        val morphSize: Int,
        val closeSize: Int,
        val minRegion: Int,
        val preBlurSigma: Double,
        val normalizeLuma: Boolean,
        val highlightR: Int,
        val highlightG: Int,
        val highlightB: Int,
        val highlightAlpha: Double
    )

    data class Stats(
        val changedPct: Double,
        val changedPixels: Int,
        val regions: Int
    )

    /** Optional alignment that was applied. JSON arrays as produced by AlignmentFragment. */
    data class Warp(
        val srcJson: String,
        val dstJson: String
    )

    /**
     * Build an Evidence Pack v1 zip into a byte array.
     *
     * The result is small enough to hold in memory (typical 2 to 10 MB for
     * a phone-sized JPEG pair) and a single byte array is what every
     * transport (file share, direct upload) needs.
     */
    fun build(
        label: String,
        capturedAtMs: Long,
        params: Params,
        stats: Stats?,
        beforeJpg: ByteArray,
        afterJpg: ByteArray,
        resultPng: ByteArray? = null,
        warp: Warp? = null
    ): ByteArray {
        val isoTimestamp = isoFormatter.format(Date(capturedAtMs))
        val manifest = buildManifestJson(label, isoTimestamp, stats, params, warp, includeResult = resultPng != null)

        val out = ByteArrayOutputStream(64 * 1024)
        ZipOutputStream(out).use { zip ->
            zip.putNextEntry(ZipEntry("manifest.json"))
            zip.write(manifest.toByteArray(Charsets.UTF_8))
            zip.closeEntry()

            zip.putNextEntry(ZipEntry("before.jpg"))
            zip.write(beforeJpg)
            zip.closeEntry()

            zip.putNextEntry(ZipEntry("after.jpg"))
            zip.write(afterJpg)
            zip.closeEntry()

            if (resultPng != null) {
                zip.putNextEntry(ZipEntry("result.png"))
                zip.write(resultPng)
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    private fun buildManifestJson(
        label: String,
        capturedAtIso: String,
        stats: Stats?,
        params: Params,
        warp: Warp?,
        includeResult: Boolean
    ): String {
        val warpJson = if (warp != null) {
            ""","warp":{"src":${warp.srcJson},"dst":${warp.dstJson}}"""
        } else ""

        val resultEntry = if (includeResult) ""","result":"result.png"""" else ""

        val statsObj = stats?.let {
            """{"changedPct":${it.changedPct},"changedPixels":${it.changedPixels},"regions":${it.regions}}"""
        } ?: """{"changedPct":0,"changedPixels":0,"regions":0}"""

        return """{
  "version": 1,
  "label": "${escape(label)}",
  "capturedAt": "$capturedAtIso",
  "source": "phone:android",
  "stats": $statsObj,
  "params": {
    "strength": ${params.strength},
    "morphSize": ${params.morphSize},
    "closeSize": ${params.closeSize},
    "minRegion": ${params.minRegion},
    "preBlurSigma": ${params.preBlurSigma},
    "normalizeLuma": ${params.normalizeLuma},
    "highlightR": ${params.highlightR},
    "highlightG": ${params.highlightG},
    "highlightB": ${params.highlightB},
    "highlightAlpha": ${params.highlightAlpha}
  }$warpJson,
  "files": {
    "before": "before.jpg",
    "after": "after.jpg"$resultEntry
  }
}
"""
    }

    private fun escape(s: String): String = s
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")

    private val isoFormatter: SimpleDateFormat by lazy {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
    }
}
