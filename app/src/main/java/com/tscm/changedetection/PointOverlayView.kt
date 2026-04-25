package com.tscm.changedetection

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.util.AttributeSet
import android.view.View

/**
 * Transparent overlay view that sits on top of an ImageView and draws
 * numbered point markers. Sits in a FrameLayout over the ImageView so
 * touch events pass through to the ImageView underneath.
 *
 * Call setPoints() to update what gets drawn.
 */
class PointOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyle: Int = 0
) : View(context, attrs, defStyle) {

    // Confirmed points: (normalized x, normalized y) → label number
    // Coordinates are in IMAGE pixel space; we convert to view space on draw.
    private var confirmedPoints: List<Pair<Pair<Float, Float>, Int>> = emptyList()
    private var pendingPoint: Pair<Float, Float>? = null
    private var imgW: Float = 1f
    private var imgH: Float = 1f
    private var dotColor: Int = Color.RED

    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = Color.WHITE
        strokeWidth = 3f
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 28f
        typeface = Typeface.DEFAULT_BOLD
        textAlign = Paint.Align.CENTER
    }
    private val pendingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.YELLOW
        alpha = 180
    }

    fun setPoints(
        confirmed: List<Pair<Pair<Float, Float>, Int>>,
        pending: Pair<Float, Float>?,
        imageWidth: Float,
        imageHeight: Float,
        color: Int
    ) {
        confirmedPoints = confirmed
        pendingPoint = pending
        imgW = imageWidth
        imgH = imageHeight
        dotColor = color
        fillPaint.color = color
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        val viewW = width.toFloat()
        val viewH = height.toFloat()

        // Match the CENTER_INSIDE scaling logic from AlignmentFragment
        val scale = minOf(viewW / imgW, viewH / imgH)
        val offsetX = (viewW - imgW * scale) / 2f
        val offsetY = (viewH - imgH * scale) / 2f

        fun toViewX(imgX: Float) = offsetX + imgX * scale
        fun toViewY(imgY: Float) = offsetY + imgY * scale

        val radius = 22f

        // Draw confirmed points
        for ((pt, label) in confirmedPoints) {
            val vx = toViewX(pt.first)
            val vy = toViewY(pt.second)

            // Filled dot
            fillPaint.alpha = 220
            canvas.drawCircle(vx, vy, radius, fillPaint)

            // White border
            canvas.drawCircle(vx, vy, radius, strokePaint)

            // Number label
            canvas.drawText(label.toString(), vx, vy + textPaint.textSize / 3f, textPaint)
        }

        // Draw pending point (yellow, pulsing would need animation — static for now)
        pendingPoint?.let { pt ->
            val vx = toViewX(pt.first)
            val vy = toViewY(pt.second)
            canvas.drawCircle(vx, vy, radius, pendingPaint)
            canvas.drawCircle(vx, vy, radius, strokePaint)
            canvas.drawText("?", vx, vy + textPaint.textSize / 3f, textPaint)
        }
    }
}
