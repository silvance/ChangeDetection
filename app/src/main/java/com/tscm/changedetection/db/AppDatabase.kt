package com.tscm.changedetection.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities = [AnalysisEntity::class], version = 4, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun analysisDao(): AnalysisDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        // ── Migration v3 → v4 ────────────────────────────────────────────────
        // Adds the per-scan analysis parameters and the (optional) alignment
        // point JSON columns. Existing rows get the same defaults the
        // ViewModel uses, so loading legacy scans is still well-defined.
        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN strength INTEGER NOT NULL DEFAULT 75")
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN morphSize INTEGER NOT NULL DEFAULT 7")
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN closeSize INTEGER NOT NULL DEFAULT 5")
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN minRegion INTEGER NOT NULL DEFAULT 25")
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN preBlurSigma REAL NOT NULL DEFAULT 2.0")
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN normalizeLuma INTEGER NOT NULL DEFAULT 1")
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN highlightR INTEGER NOT NULL DEFAULT 255")
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN highlightG INTEGER NOT NULL DEFAULT 60")
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN highlightB INTEGER NOT NULL DEFAULT 60")
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN highlightAlpha REAL NOT NULL DEFAULT 0.55")
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN warpSrcJson TEXT")
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN warpDstJson TEXT")
            }
        }

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "tscm_database"
                )
                    .addMigrations(MIGRATION_3_4)
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
