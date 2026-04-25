package com.tscm.changedetection.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface AnalysisDao {
    @Query("SELECT id, timestamp, label, beforeFileName, afterFileName, resultFileName, changedPct, changedPixels, regions FROM analysis_history ORDER BY timestamp DESC")
    fun getAllHistory(): Flow<List<AnalysisEntity>>

    @Insert
    suspend fun insert(analysis: AnalysisEntity)

    @Query("DELETE FROM analysis_history WHERE id = :id")
    suspend fun deleteById(id: Int)
}
