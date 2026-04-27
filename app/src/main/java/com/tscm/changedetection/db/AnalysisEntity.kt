package com.tscm.changedetection.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "analysis_history")
data class AnalysisEntity(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
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
