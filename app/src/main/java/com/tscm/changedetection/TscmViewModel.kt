package com.tscm.changedetection

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tscmlib.Tscmlib
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream

// ─────────────────────────────────────────────────────────────────────────────
// State classes
// These represent what the UI can be in at any given moment.
// ─────────────────────────────────────────────────────────────────────────────

sealed class AnalysisState {
    object Idle : AnalysisState()
    object Running : AnalysisState()
    data class Success(
        val highlightBitmap: Bitmap,
        val changedPct: Double,
        val changedPixels: Int,
        val regions: Int,
        val resized: Boolean
    ) : AnalysisState()
    data class Error(val message: String) : AnalysisState()
}

sealed class AlternateState {
    object Idle : AlternateState()
    object Running : AlternateState()
    data class Success(
        val diffBitmap: Bitmap,
        val subtractionBitmap: Bitmap,
        val heatmapBitmap: Bitmap,
        val cannyBitmap: Bitmap,
        val contoursBitmap: Bitmap
    ) : AlternateState()
    data class Error(val message: String) : AlternateState()
}

// ─────────────────────────────────────────────────────────────────────────────
// ViewModel
// ─────────────────────────────────────────────────────────────────────────────

class TscmViewModel : ViewModel() {

    // ── Raw image bytes ───────────────────────────────────────────────────────
    // These are what the camera gives us (JPEG) or what WarpPerspective returns
    // (PNG). The Go library accepts both formats.

    private val _beforeBytes = MutableStateFlow<ByteArray?>(null)
    val beforeBytes: StateFlow<ByteArray?> = _beforeBytes.asStateFlow()

    private val _afterBytes = MutableStateFlow<ByteArray?>(null)
    val afterBytes: StateFlow<ByteArray?> = _afterBytes.asStateFlow()

    // Set by WarpPerspective — replaces beforeBytes as the analysis input
    // when set, same as how the web app's state.Store works.
    private var warpedBeforeBytes: ByteArray? = null

    // The point pairs that produced the active warp, retained so saved scans
    // can record exactly which alignment was applied.
    private var warpSrcJson: String? = null
    private var warpDstJson: String? = null

    // Preview bitmaps shown in the capture UI (decoded once on capture)
    private val _beforeBitmap = MutableStateFlow<Bitmap?>(null)
    val beforeBitmap: StateFlow<Bitmap?> = _beforeBitmap.asStateFlow()

    private val _afterBitmap = MutableStateFlow<Bitmap?>(null)
    val afterBitmap: StateFlow<Bitmap?> = _afterBitmap.asStateFlow()

    // ── Analysis parameters ───────────────────────────────────────────────────
    // These back the SeekBar controls in AnalysisFragment.
    // Defaults match the web app.

    var strength: Int = 75          // Detection Strength (5–100)
    var morphSize: Int = 7          // Noise Reduction (1–15)
    var closeSize: Int = 5          // Fill Gaps (1–15)
    var minRegion: Int = 25         // Min Region Size (pixels)
    var preBlurSigma: Double = 2.0  // Pre-blur σ (0.0–4.0)
    var normalizeLuma: Boolean = true
    var stripMetadata: Boolean = true

    // Highlight colour — red by default
    var highlightR: Int = 255
    var highlightG: Int = 60
    var highlightB: Int = 60
    var highlightAlpha: Double = 0.55

    // ── Analysis results ──────────────────────────────────────────────────────

    private val _analysisState = MutableStateFlow<AnalysisState>(AnalysisState.Idle)
    val analysisState: StateFlow<AnalysisState> = _analysisState.asStateFlow()

    private val _alternateState = MutableStateFlow<AlternateState>(AlternateState.Idle)
    val alternateState: StateFlow<AlternateState> = _alternateState.asStateFlow()

    private val _saveStatus = MutableStateFlow<Boolean?>(null)
    val saveStatus: StateFlow<Boolean?> = _saveStatus.asStateFlow()

    private val _exportUris = MutableStateFlow<List<Uri>?>(null)
    val exportUris: StateFlow<List<Uri>?> = _exportUris.asStateFlow()

    // ── Image setters (called from CaptureFragment) ───────────────────────────

    fun setBefore(jpegBytes: ByteArray) {
        val processedBytes = if (stripMetadata) stripExif(jpegBytes) else jpegBytes
        _beforeBytes.value = processedBytes
        warpedBeforeBytes = null // clear any previous warp
        warpSrcJson = null
        warpDstJson = null
        _analysisState.value = AnalysisState.Idle
        _alternateState.value = AlternateState.Idle

        // Decode a preview bitmap on a background thread
        viewModelScope.launch(Dispatchers.IO) {
            _beforeBitmap.value = decodeBitmap(processedBytes)
        }
    }

    fun setAfter(jpegBytes: ByteArray) {
        val processedBytes = if (stripMetadata) stripExif(jpegBytes) else jpegBytes
        _afterBytes.value = processedBytes
        warpedBeforeBytes = null
        warpSrcJson = null
        warpDstJson = null
        _analysisState.value = AnalysisState.Idle
        _alternateState.value = AlternateState.Idle

        viewModelScope.launch(Dispatchers.IO) {
            _afterBitmap.value = decodeBitmap(processedBytes)
        }
    }

    // ── Convenience check ─────────────────────────────────────────────────────

    fun hasImages(): Boolean =
        _beforeBytes.value != null && _afterBytes.value != null

    fun hasActiveWarp(): Boolean = warpedBeforeBytes != null

    // ── Primary analysis ──────────────────────────────────────────────────────

    fun runAnalysis() {
        val before = warpedBeforeBytes ?: _beforeBytes.value ?: return
        val after = _afterBytes.value ?: return

        // Drop the request if an analysis is already in flight — otherwise a
        // user double-tap launches two coroutines that race on _analysisState.
        if (_analysisState.value is AnalysisState.Running) return

        viewModelScope.launch {
            _analysisState.value = AnalysisState.Running

            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val opts = Tscmlib.defaultOptions().apply {
                        setStrength(strength)
                        setMorphSize(morphSize)
                        setCloseSize(closeSize)
                        setMinRegion(minRegion)
                        setPreBlurSigma(preBlurSigma)
                        setNormalizeLuma(normalizeLuma)
                        setHighlightR(highlightR)
                        setHighlightG(highlightG)
                        setHighlightB(highlightB)
                        setHighlightAlpha(highlightAlpha)
                    }
                    Tscmlib.analyze(before, after, opts)
                }
            }

            result.fold(
                onSuccess = { r ->
                    val bitmap = decodeBitmap(r.highlightPNG)
                    if (bitmap != null) {
                        _analysisState.value = AnalysisState.Success(
                            highlightBitmap = bitmap,
                            changedPct = r.changedPct,
                            changedPixels = r.changedPixels.toInt(),
                            regions = r.regions.toInt(),
                            resized = r.resized
                        )
                    } else {
                        _analysisState.value = AnalysisState.Error("Failed to decode result image")
                    }
                },
                onFailure = { e ->
                    _analysisState.value = AnalysisState.Error(e.message ?: "Unknown error")
                }
            )
        }
    }

    // ── Alternate analysis ────────────────────────────────────────────────────

    fun runAlternateAnalysis() {
        val before = warpedBeforeBytes ?: _beforeBytes.value ?: return
        val after = _afterBytes.value ?: return

        if (_alternateState.value is AlternateState.Running) return

        viewModelScope.launch {
            _alternateState.value = AlternateState.Running

            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val opts = Tscmlib.defaultOptions().apply {
                        setStrength(strength)
                        setMorphSize(morphSize)
                        setCloseSize(closeSize)
                        setMinRegion(minRegion)
                        setPreBlurSigma(preBlurSigma)
                        setNormalizeLuma(normalizeLuma)
                    }
                    Tscmlib.analyzeAlternate(before, after, opts)
                }
            }

            result.fold(
                onSuccess = { r ->
                    val diff        = decodeBitmap(r.diffPNG)
                    val subtraction = decodeBitmap(r.subtractionPNG)
                    val heatmap     = decodeBitmap(r.heatmapPNG)
                    val canny       = decodeBitmap(r.cannyPNG)
                    val contours    = decodeBitmap(r.contoursPNG)

                    if (diff != null && subtraction != null &&
                        heatmap != null && canny != null && contours != null) {
                        _alternateState.value = AlternateState.Success(
                            diffBitmap        = diff,
                            subtractionBitmap = subtraction,
                            heatmapBitmap     = heatmap,
                            cannyBitmap       = canny,
                            contoursBitmap    = contours
                        )
                    } else {
                        _alternateState.value = AlternateState.Error("Failed to decode one or more result images")
                    }
                },
                onFailure = { e ->
                    _alternateState.value = AlternateState.Error(e.message ?: "Unknown error")
                }
            )
        }
    }

    // ── Warp ─────────────────────────────────────────────────────────────────
    // Called from the alignment dialog once the user places their point pairs.
    // srcPtsJson / dstPtsJson are JSON arrays like [[x,y],[x,y],...] (4–8 pairs).

    fun applyWarp(srcPtsJson: String, dstPtsJson: String, onComplete: (Bitmap?) -> Unit) {
        val before = _beforeBytes.value ?: return
        val after  = _afterBytes.value ?: return

        viewModelScope.launch {
            val warpedResult = withContext(Dispatchers.IO) {
                runCatching {
                    val bytes = Tscmlib.warpPerspective(before, after, srcPtsJson, dstPtsJson)
                    val bmp = decodeBitmap(bytes)
                    Pair(bytes, bmp)
                }.getOrNull()
            }

            warpedBeforeBytes = warpedResult?.first
            if (warpedBeforeBytes != null) {
                warpSrcJson = srcPtsJson
                warpDstJson = dstPtsJson
            }
            _analysisState.value = AnalysisState.Idle  // force re-run with new warp
            onComplete(warpedResult?.second)
        }
    }

    fun clearWarp() {
        warpedBeforeBytes = null
        warpSrcJson = null
        warpDstJson = null
        _analysisState.value = AnalysisState.Idle
    }

    // ── History Persistence ──────────────────────────────────────────────────

    fun loadFromHistory(context: Context, entity: com.tscm.changedetection.db.AnalysisEntity) {
        viewModelScope.launch(Dispatchers.IO) {
            val before = File(context.filesDir, entity.beforeFileName).readBytes()
            val after = File(context.filesDir, entity.afterFileName).readBytes()
            val result = entity.resultFileName?.let { File(context.filesDir, it).readBytes() }

            val beforeBmp = decodeBitmap(before)
            val afterBmp = decodeBitmap(after)
            val resultBmp = result?.let { decodeBitmap(it) }

            withContext(Dispatchers.Main) {
                _beforeBytes.value = before
                _afterBytes.value = after
                // Restore the alignment that was used so the user can see it
                // was active. We don't auto re-warp here — the saved result
                // bitmap is authoritative; if the user re-aligns and re-runs,
                // they'll start from a known state.
                warpedBeforeBytes = null
                warpSrcJson = entity.warpSrcJson
                warpDstJson = entity.warpDstJson

                // Restore the parameters used for this scan so further
                // analysis on this evidence reproduces the same numbers.
                strength = entity.strength
                morphSize = entity.morphSize
                closeSize = entity.closeSize
                minRegion = entity.minRegion
                preBlurSigma = entity.preBlurSigma
                normalizeLuma = entity.normalizeLuma
                highlightR = entity.highlightR
                highlightG = entity.highlightG
                highlightB = entity.highlightB
                highlightAlpha = entity.highlightAlpha

                _beforeBitmap.value = beforeBmp
                _afterBitmap.value = afterBmp

                if (resultBmp != null) {
                    _analysisState.value = AnalysisState.Success(
                        highlightBitmap = resultBmp,
                        changedPct = entity.changedPct,
                        changedPixels = entity.changedPixels,
                        regions = entity.regions,
                        resized = false // loaded state
                    )
                } else {
                    _analysisState.value = AnalysisState.Idle
                }
            }
        }
    }

    fun saveCurrentToHistory(context: Context, db: com.tscm.changedetection.db.AppDatabase, label: String, resultPNG: ByteArray?) {
        val before = _beforeBytes.value ?: return
        val after = _afterBytes.value ?: return
        val state = _analysisState.value
        
        val (pct, pixels, regions) = if (state is AnalysisState.Success) {
            Triple(state.changedPct, state.changedPixels, state.regions)
        } else {
            Triple(0.0, 0, 0)
        }

        viewModelScope.launch(Dispatchers.IO) {
            val ts = System.currentTimeMillis()
            val beforeName = "before_$ts.jpg"
            val afterName = "after_$ts.jpg"
            val resultName = resultPNG?.let { "result_$ts.png" }

            File(context.filesDir, beforeName).writeBytes(before)
            File(context.filesDir, afterName).writeBytes(after)
            resultPNG?.let { File(context.filesDir, resultName!!).writeBytes(it) }

            val entity = com.tscm.changedetection.db.AnalysisEntity(
                timestamp = ts,
                label = label,
                beforeFileName = beforeName,
                afterFileName = afterName,
                resultFileName = resultName,
                changedPct = pct,
                changedPixels = pixels,
                regions = regions,
                strength = strength,
                morphSize = morphSize,
                closeSize = closeSize,
                minRegion = minRegion,
                preBlurSigma = preBlurSigma,
                normalizeLuma = normalizeLuma,
                highlightR = highlightR,
                highlightG = highlightG,
                highlightB = highlightB,
                highlightAlpha = highlightAlpha,
                warpSrcJson = warpSrcJson,
                warpDstJson = warpDstJson
            )
            db.analysisDao().insert(entity)
            _saveStatus.value = true
        }
    }

    fun resetSaveStatus() {
        _saveStatus.value = null
    }

    fun exportAnalysis(context: Context, label: String) {
        val state = _analysisState.value
        if (state !is AnalysisState.Success) return
        
        val before = _beforeBytes.value ?: return
        val after = _afterBytes.value ?: return

        viewModelScope.launch(Dispatchers.IO) {
            try {
                val cachePath = File(context.cacheDir, "analysis_export")
                cachePath.mkdirs()
                
                // Clear old exports
                cachePath.listFiles()?.forEach { it.delete() }

                val uris = mutableListOf<Uri>()
                val timestamp = label.replace(" ", "_")

                // 1. Export Analysis Result
                val resFile = File(cachePath, "REPORT_${timestamp}_RESULT.png")
                FileOutputStream(resFile).use { state.highlightBitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                uris.add(FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", resFile))

                // 2. Export Before Photo
                val beforeFile = File(cachePath, "REPORT_${timestamp}_BEFORE.jpg")
                FileOutputStream(beforeFile).use { it.write(before) }
                uris.add(FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", beforeFile))

                // 3. Export After Photo
                val afterFile = File(cachePath, "REPORT_${timestamp}_AFTER.jpg")
                FileOutputStream(afterFile).use { it.write(after) }
                uris.add(FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", afterFile))

                _exportUris.value = uris
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun resetExportUris() {
        _exportUris.value = null
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun stripExif(bytes: ByteArray): ByteArray {
        return try {
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return bytes

            // BitmapFactory ignores EXIF, so any rotation tag stays only as
            // metadata. If we just strip metadata we'd end up with a sideways
            // image whenever the source was a portrait phone shot or a
            // gallery import. Apply the rotation to actual pixels first.
            val rotated = applyExifRotation(bytes, bitmap)

            val stream = java.io.ByteArrayOutputStream()
            rotated.compress(Bitmap.CompressFormat.JPEG, 95, stream)
            val result = stream.toByteArray()

            if (rotated !== bitmap) bitmap.recycle()
            rotated.recycle()

            result
        } catch (e: Exception) {
            bytes
        }
    }

    private fun applyExifRotation(bytes: ByteArray, bitmap: Bitmap): Bitmap {
        return try {
            val orientation = ByteArrayInputStream(bytes).use { stream ->
                ExifInterface(stream).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL
                )
            }
            val matrix = Matrix()
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270f); matrix.postScale(-1f, 1f) }
                else -> return bitmap
            }
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        } catch (e: Exception) {
            bitmap
        }
    }

    /**
     * Decodes bytes into a bitmap **for display only**, sub-sampled to roughly
     * [PREVIEW_MAX_DIM] on the long side. The original bytes are still held
     * untouched in the StateFlows and are what the Go analysis library reads,
     * so we don't lose precision where it matters — we only avoid keeping
     * 50–200 MB ARGB bitmaps in memory for the on-screen previews.
     */
    private fun decodeBitmap(bytes: ByteArray): Bitmap? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)

        val w = bounds.outWidth
        val h = bounds.outHeight
        if (w <= 0 || h <= 0) return@runCatching null

        var sample = 1
        val maxDim = maxOf(w, h)
        while (maxDim / (sample * 2) >= PREVIEW_MAX_DIM) sample *= 2

        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    }.getOrNull()

    private companion object {
        // Long-side cap for preview bitmaps. Anything beyond this is invisible
        // detail on a phone screen and a fast path to OOM on big-sensor shots.
        const val PREVIEW_MAX_DIM = 2048
    }
}
