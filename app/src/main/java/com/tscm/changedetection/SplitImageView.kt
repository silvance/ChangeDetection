package com.tscm.changedetection

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View

/**
 * Renders two bitmaps split by a draggable divider, with correct aspect ratio.
 *
 * Both images are scaled to CENTER_INSIDE (letterboxed) independently, then
 * clipped at the split position. The divider and handle are drawn on top.
 *
 * Orientations:
 *   HORIZONTAL — Before on left, After on right, drag divider left/right
 *   VERTICAL   — Before on top, After on bottom, drag divider up/down
 */
class SplitImageView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyle: Int = 0
) : View(context, attrs, defStyle) {

    enum class Orientation { HORIZONTAL, VERTICAL }

    private var beforeBitmap: Bitmap? = null
    private var afterBitmap: Bitmap? = null

    var orientation: Orientation = Orientation.HORIZONTAL
        set(value) { field = value; invalidate() }

    // Split position as a fraction 0.0–1.0 of the view dimension
    private var splitFraction = 0.5f

    private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)

    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        strokeWidth = 4f
        style = Paint.Style.STROKE
    }
    private val handleFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.parseColor("#CC444444")
        style = Paint.Style.FILL
    }
    private val handleStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        strokeWidth = 3f
        style = Paint.Style.STROKE
    }
    private val arrowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        strokeWidth = 3f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        textSize = 38f
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        setShadowLayer(5f, 0f, 0f, android.graphics.Color.BLACK)
    }

    fun setBitmaps(before: Bitmap?, after: Bitmap?) {
        beforeBitmap = before
        afterBitmap = after
        invalidate()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.action) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                splitFraction = if (orientation == Orientation.HORIZONTAL) {
                    (event.x / width.toFloat()).coerceIn(0.05f, 0.95f)
                } else {
                    (event.y / height.toFloat()).coerceIn(0.05f, 0.95f)
                }
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val vw = width.toFloat()
        val vh = height.toFloat()
        if (vw == 0f || vh == 0f) return

        val splitPx = if (orientation == Orientation.HORIZONTAL)
            vw * splitFraction else vh * splitFraction

        // Draw Before
        beforeBitmap?.let { bmp ->
            if (!bmp.isRecycled) {
                val matrix = centerInsideMatrix(bmp, vw, vh)
                canvas.save()
                if (orientation == Orientation.HORIZONTAL)
                    canvas.clipRect(0f, 0f, splitPx, vh)
                else
                    canvas.clipRect(0f, 0f, vw, splitPx)
                canvas.drawBitmap(bmp, matrix, bitmapPaint)
                canvas.restore()
            }
        }

        // Draw After
        afterBitmap?.let { bmp ->
            if (!bmp.isRecycled) {
                val matrix = centerInsideMatrix(bmp, vw, vh)
                canvas.save()
                if (orientation == Orientation.HORIZONTAL)
                    canvas.clipRect(splitPx, 0f, vw, vh)
                else
                    canvas.clipRect(0f, splitPx, vw, vh)
                canvas.drawBitmap(bmp, matrix, bitmapPaint)
                canvas.restore()
            }
        }

        // Divider line
        if (orientation == Orientation.HORIZONTAL) {
            canvas.drawLine(splitPx, 0f, splitPx, vh, linePaint)
        } else {
            canvas.drawLine(0f, splitPx, vw, splitPx, linePaint)
        }

        // Handle
        drawHandle(canvas, vw, vh, splitPx)

        // Labels
        drawLabels(canvas, vw, vh, splitPx)
    }

    private fun drawHandle(canvas: Canvas, vw: Float, vh: Float, splitPx: Float) {
        val cx: Float
        val cy: Float
        if (orientation == Orientation.HORIZONTAL) {
            cx = splitPx
            cy = vh / 2f
        } else {
            cx = vw / 2f
            cy = splitPx
        }

        val r = 30f
        canvas.drawCircle(cx, cy, r, handleFillPaint)
        canvas.drawCircle(cx, cy, r, handleStrokePaint)

        // Arrow chevrons pointing in the drag direction
        if (orientation == Orientation.HORIZONTAL) {
            // Left arrow
            canvas.drawLine(cx - 8f, cy - 10f, cx - 18f, cy, arrowPaint)
            canvas.drawLine(cx - 8f, cy + 10f, cx - 18f, cy, arrowPaint)
            // Right arrow
            canvas.drawLine(cx + 8f, cy - 10f, cx + 18f, cy, arrowPaint)
            canvas.drawLine(cx + 8f, cy + 10f, cx + 18f, cy, arrowPaint)
        } else {
            // Up arrow
            canvas.drawLine(cx - 10f, cy - 8f, cx, cy - 18f, arrowPaint)
            canvas.drawLine(cx + 10f, cy - 8f, cx, cy - 18f, arrowPaint)
            // Down arrow
            canvas.drawLine(cx - 10f, cy + 8f, cx, cy + 18f, arrowPaint)
            canvas.drawLine(cx + 10f, cy + 8f, cx, cy + 18f, arrowPaint)
        }
    }

    private fun drawLabels(canvas: Canvas, vw: Float, vh: Float, splitPx: Float) {
        val padding = 14f
        val labelH = labelPaint.textSize

        if (orientation == Orientation.HORIZONTAL) {
            // BEFORE — top-left, only if there's room
            if (splitPx > 80f)
                canvas.drawText("BEFORE", padding, labelH + padding, labelPaint)
            // AFTER — top-right
            val afterW = labelPaint.measureText("AFTER")
            if (vw - splitPx > 80f)
                canvas.drawText("AFTER", vw - afterW - padding, labelH + padding, labelPaint)
        } else {
            // BEFORE — top-left
            if (splitPx > 50f)
                canvas.drawText("BEFORE", padding, labelH + padding, labelPaint)
            // AFTER — below divider
            if (vh - splitPx > 50f)
                canvas.drawText("AFTER", padding, splitPx + labelH + padding, labelPaint)
        }
    }

    /**
     * Builds a Matrix that scales [bmp] to CENTER_INSIDE within [vw]×[vh],
     * centering it both horizontally and vertically.
     */
    private fun centerInsideMatrix(bmp: Bitmap, vw: Float, vh: Float): Matrix {
        if (bmp.isRecycled) return Matrix()
        val bw = bmp.width.toFloat()
        val bh = bmp.height.toFloat()
        val scale = minOf(vw / bw, vh / bh)
        val dx = (vw - bw * scale) / 2f
        val dy = (vh - bh * scale) / 2f
        return Matrix().apply { setScale(scale, scale); postTranslate(dx, dy) }
    }
}
