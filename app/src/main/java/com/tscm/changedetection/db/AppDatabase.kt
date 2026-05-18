package com.tscm.changedetection.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities = [AnalysisEntity::class], version = 5, exportSchema = false)
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

        // ── Migration v4 → v5 ────────────────────────────────────────────────
        // Adds the cross-device scan UUID. We can't put randomness in the
        // ALTER TABLE default (SQLite uses a single literal for all existing
        // rows), so we add the column with an empty default and then UPDATE
        // every row with a per-row random 32-hex-char value. New rows get a
        // proper Java UUID from the entity default thereafter.
        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE analysis_history ADD COLUMN uuid TEXT NOT NULL DEFAULT ''")
                db.execSQL("UPDATE analysis_history SET uuid = lower(hex(randomblob(16))) WHERE uuid = ''")
            }
        }

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "tscm_database"
                )
                    .addMigrations(MIGRATION_3_4, MIGRATION_4_5)
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
