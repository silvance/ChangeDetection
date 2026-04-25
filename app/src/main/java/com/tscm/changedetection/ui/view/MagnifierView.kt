package com.tscm.changedetection.ui.view

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import android.widget.ImageView

class MagnifierView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null, defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private var targetImageView: ImageView? = null
    private var zoomBitmap: Bitmap? = null
    private val matrix = Matrix()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#00E5FF")
        style = Paint.Style.STROKE
        strokeWidth = 4f
    }

    private var touchX = -1f
    private var touchY = -1f
    private val magnifierRadius = 200f
    private val zoomFactor = 2.5f

    // Cached values to avoid re-calculating on every draw
    private var lastViewW = -1f
    private var lastViewH = -1f
    private var lastImgW = -1f
    private var lastImgH = -1f
    private var cachedScale = 1f
    private var cachedOffsetX = 0f
    private var cachedOffsetY = 0f

    fun updatePosition(x: Float, y: Float) {
        touchX = x
        touchY = y
        invalidate()
    }

    fun setBitmap(bitmap: Bitmap?) {
        if (this.zoomBitmap == bitmap) return
        this.zoomBitmap = bitmap
        // Reset cached values because image dimensions might have changed
        lastImgW = -1f
        invalidate()
    }

    fun setup(imageView: ImageView) {
        this.targetImageView = imageView
        // Ensure the view is ready to receive touches
        visibility = VISIBLE
        isClickable = true
        isEnabled = true
        isFocusable = true
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        // Forcefully claim the touch gesture as soon as it starts if we have something to show.
        // We do this here AND in onTouchEvent to be absolutely sure parents like NestedScrollView 
        // don't intercept vertical moves.
        if (zoomBitmap != null && !zoomBitmap!!.isRecycled) {
            parent?.requestDisallowInterceptTouchEvent(true)
        }
        return super.dispatchTouchEvent(event)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val bitmap = zoomBitmap
        if (bitmap == null || bitmap.isRecycled) return false

        when (event.action) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                // Repeatedly request to prevent any interception during the gesture
                parent?.requestDisallowInterceptTouchEvent(true)
                touchX = event.x
                touchY = event.y
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (event.action == MotionEvent.ACTION_UP) {
                    performClick()
                }
                touchX = -1f
                touchY = -1f
                invalidate()
                // Re-enable parent interception once the finger is lifted
                parent?.requestDisallowInterceptTouchEvent(false)
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun performClick(): Boolean {
        return super.performClick()
    }

    override fun onDraw(canvas: Canvas) {
        if (touchX == -1f || touchY == -1f) return
        val bitmap = zoomBitmap ?: return
        if (bitmap.isRecycled) return

        val viewW = width.toFloat()
        val viewH = height.toFloat()
        val imgW = bitmap.width.toFloat()
        val imgH = bitmap.height.toFloat()

        if (viewW != lastViewW || viewH != lastViewH || imgW != lastImgW || imgH != lastImgH) {
            cachedScale = minOf(viewW / imgW, viewH / imgH)
            cachedOffsetX = (viewW - imgW * cachedScale) / 2f
            cachedOffsetY = (viewH - imgH * cachedScale) / 2f
            lastViewW = viewW
            lastViewH = viewH
            lastImgW = imgW
            lastImgH = imgH
        }

        val bitmapX = (touchX - cachedOffsetX) / cachedScale
        val bitmapY = (touchY - cachedOffsetY) / cachedScale

        // Create a circular path for clipping
        val path = Path()
        path.addCircle(touchX, touchY, magnifierRadius, Path.Direction.CW)
        
        canvas.save()
        try {
            canvas.clipPath(path)
        } catch (e: UnsupportedOperationException) {
            // Fallback for very old devices without hardware clipPath support, 
            // though unlikely to be needed on modern Android.
        }
        
        // Set up the matrix for the zoomed draw
        matrix.reset()
        // 1. Pivot around the point on the bitmap we want to see
        matrix.postScale(zoomFactor, zoomFactor, bitmapX, bitmapY)
        
        // 2. Apply the same scale and offset as the base image
        matrix.postScale(cachedScale, cachedScale)
        matrix.postTranslate(cachedOffsetX, cachedOffsetY)
        
        canvas.drawBitmap(bitmap, matrix, paint)
        canvas.restore()
        
        // Draw the border
        canvas.drawCircle(touchX, touchY, magnifierRadius, borderPaint)
    }


    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        // Don't recycle bitmap here as it is owned by the ViewModel/Fragment
        zoomBitmap = null
    }
}
