package com.tscm.changedetection.db

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(tableName = "analysis_history")
data class AnalysisEntity(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,

    // Stable cross-device identifier. The phone generates this at save
    // time and includes it in every Evidence Pack manifest so the desktop
    // can de-duplicate re-uploads of the same scan instead of multiplying
    // history rows. Distinct from `id`, which is a phone-local autoinc.
    val uuid: String = UUID.randomUUID().toString(),

    val timestamp: Long = System.currentTimeMillis(),
    val label: String,
    val beforeFileName: String,
    val afterFileName: String,
    val resultFileName: String?,
    val changedPct: Double,
    val changedPixels: Int,
    val regions: Int,

    // ── Per-scan analysis parameters (added in schema v4) ────────────────────
    // Stored alongside the row so reloading a saved scan reproduces the same
    // numbers regardless of what the user has set globally since.
    val strength: Int = 75,
    val morphSize: Int = 7,
    val closeSize: Int = 5,
    val minRegion: Int = 25,
    val preBlurSigma: Double = 2.0,
    val normalizeLuma: Boolean = true,
    val highlightR: Int = 255,
    val highlightG: Int = 60,
    val highlightB: Int = 60,
    val highlightAlpha: Double = 0.55,

    // ── Alignment used (nullable when no warp was applied) ───────────────────
    val warpSrcJson: String? = null,
    val warpDstJson: String? = null
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as AnalysisEntity
        return id == other.id
    }

    override fun hashCode(): Int = id
}
