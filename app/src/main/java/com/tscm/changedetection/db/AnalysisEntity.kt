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
    val regions: Int
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as AnalysisEntity
        return id == other.id
    }

    override fun hashCode(): Int = id
}
