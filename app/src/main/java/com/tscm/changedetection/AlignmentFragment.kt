package com.tscm.changedetection

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.DialogFragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import com.tscm.changedetection.databinding.FragmentAlignmentBinding
import kotlinx.coroutines.launch

class AlignmentFragment : DialogFragment() {

    private var _binding: FragmentAlignmentBinding? = null
    private val binding get() = _binding!!

    private val viewModel: TscmViewModel by activityViewModels()

    // ── Point pair state ──────────────────────────────────────────────────────
    // Each pair is (srcPoint on Before, dstPoint on After).
    // We collect srcPts and dstPts in parallel lists.
    // A "pending" src point means the user has tapped Before but not yet After.

    data class PointF(val x: Float, val y: Float)

    private val srcPts = mutableListOf<PointF>()  // points on Before image
    private val dstPts = mutableListOf<PointF>()  // corresponding points on After
    private var pendingSrc: PointF? = null         // tapped Before, waiting for After

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentAlignmentBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onStart() {
        super.onStart()
        // Make the dialog full screen
        dialog?.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        // Load the current before/after bitmaps into the two image views
        val bmpBefore = viewModel.beforeBitmap.value
        val bmpAfter = viewModel.afterBitmap.value

        binding.imgAlignBefore.setImageBitmap(bmpBefore)
        binding.imgAlignAfter.setImageBitmap(bmpAfter)

        // Setup Magnifiers
        bmpBefore?.let { binding.magnifierBefore?.setBitmap(it) }
        bmpAfter?.let { binding.magnifierAfter?.setBitmap(it) }

        updateInstructions()
        updateButtons()

        // ── Before image touch ────────────────────────────────────────────────
        binding.imgAlignBefore.setOnTouchListener { v, event ->
            when (event.action) {
                android.view.MotionEvent.ACTION_DOWN -> {
                    if (srcPts.size >= 8) {
                        Toast.makeText(requireContext(), getString(R.string.msg_max_pairs), Toast.LENGTH_SHORT).show()
                        return@setOnTouchListener true
                    }
                    if (pendingSrc != null) {
                        Toast.makeText(requireContext(), getString(R.string.msg_tap_after), Toast.LENGTH_SHORT).show()
                        return@setOnTouchListener true
                    }
                    binding.magnifierBefore?.visibility = View.VISIBLE
                    binding.magnifierBefore?.updatePosition(event.x, event.y)
                }
                android.view.MotionEvent.ACTION_MOVE -> {
                    binding.magnifierBefore?.updatePosition(event.x, event.y)
                }
                android.view.MotionEvent.ACTION_UP -> {
                    binding.magnifierBefore?.visibility = View.GONE
                    
                    // Convert touch coords to image pixel coords
                    val pt = touchToImageCoords(v, event.x, event.y,
                        viewModel.beforeBitmap.value?.width ?: 1,
                        viewModel.beforeBitmap.value?.height ?: 1)

                    pendingSrc = pt
                    updateInstructions()
                    updateOverlays()
                }
                android.view.MotionEvent.ACTION_CANCEL -> {
                    binding.magnifierBefore?.visibility = View.GONE
                }
            }
            true
        }

        // ── After image touch ─────────────────────────────────────────────────
        binding.imgAlignAfter.setOnTouchListener { v, event ->
            when (event.action) {
                android.view.MotionEvent.ACTION_DOWN -> {
                    val src = pendingSrc
                    if (src == null) {
                        Toast.makeText(requireContext(), getString(R.string.msg_tap_before_first), Toast.LENGTH_SHORT).show()
                        return@setOnTouchListener true
                    }
                    binding.magnifierAfter?.visibility = View.VISIBLE
                    binding.magnifierAfter?.updatePosition(event.x, event.y)
                }
                android.view.MotionEvent.ACTION_MOVE -> {
                    binding.magnifierAfter?.updatePosition(event.x, event.y)
                }
                android.view.MotionEvent.ACTION_UP -> {
                    binding.magnifierAfter?.visibility = View.GONE

                    val pt = touchToImageCoords(v, event.x, event.y,
                        viewModel.afterBitmap.value?.width ?: 1,
                        viewModel.afterBitmap.value?.height ?: 1)

                    // Record the completed pair
                    srcPts.add(pendingSrc!!)
                    dstPts.add(pt)
                    pendingSrc = null

                    updateInstructions()
                    updateOverlays()
                    updateButtons()
                }
                android.view.MotionEvent.ACTION_CANCEL -> {
                    binding.magnifierAfter?.visibility = View.GONE
                }
            }
            true
        }

        // ── Undo button ───────────────────────────────────────────────────────
        binding.btnUndo.setOnClickListener {
            if (pendingSrc != null) {
                // Just had a Before tap with no After yet — clear the pending point
                pendingSrc = null
            } else if (srcPts.isNotEmpty()) {
                // Remove the last completed pair
                srcPts.removeLastOrNull()
                dstPts.removeLastOrNull()
            }
            updateInstructions()
            updateOverlays()
            updateButtons()
        }

        // ── Confirm button ────────────────────────────────────────────────────
        binding.btnConfirmWarp.setOnClickListener {
            if (srcPts.size < 4) {
                Toast.makeText(requireContext(), "Place at least 4 pairs before confirming", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            binding.btnConfirmWarp.isEnabled = false
            binding.btnConfirmWarp.text = getString(R.string.btn_warping)

            val srcJson = srcPts.toJson()
            val dstJson = dstPts.toJson()

            viewModel.applyWarp(srcJson, dstJson) { warpedBitmap ->
                if (warpedBitmap != null) {
                    Toast.makeText(requireContext(), getString(R.string.msg_align_applied), Toast.LENGTH_SHORT).show()
                    dismiss()
                } else {
                    Toast.makeText(requireContext(), getString(R.string.msg_align_failed), Toast.LENGTH_LONG).show()
                    binding.btnConfirmWarp.isEnabled = true
                    binding.btnConfirmWarp.text = getString(R.string.label_apply)
                }
            }
        }

        // ── Cancel button ─────────────────────────────────────────────────────
        binding.btnCancelWarp.setOnClickListener {
            dismiss()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    // ── Instruction text ──────────────────────────────────────────────────────

    private fun updateInstructions() {
        val pairsComplete = srcPts.size
        val isLand = resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE

        binding.txtAlignInstructions.text = when {
            pairsComplete >= 8 -> getString(R.string.instruct_align_max)
            pendingSrc != null -> getString(if (isLand) R.string.instruct_align_pending_land else R.string.instruct_align_pending)
            pairsComplete == 0 -> getString(R.string.instruct_align_start)
            pairsComplete < 4  -> getString(if (isLand) R.string.instruct_align_progress_land else R.string.instruct_align_progress, pairsComplete)
            else               -> getString(if (isLand) R.string.instruct_align_min_met_land else R.string.instruct_align_min_met, pairsComplete)
        }
    }

    // ── Overlay dots ──────────────────────────────────────────────────────────
    // Draws numbered dots on both ImageViews by updating the overlay views.
    // We pass the point lists to the custom PointOverlayView which handles drawing.

    private fun updateOverlays() {
        binding.overlayBefore.setPoints(
            confirmed = srcPts.mapIndexed { i, p -> Pair(p.x, p.y) to (i + 1) },
            pending = pendingSrc?.let { Pair(it.x, it.y) },
            imageWidth = viewModel.beforeBitmap.value?.width?.toFloat() ?: 1f,
            imageHeight = viewModel.beforeBitmap.value?.height?.toFloat() ?: 1f,
            color = android.graphics.Color.RED
        )
        binding.overlayAfter.setPoints(
            confirmed = dstPts.mapIndexed { i, p -> Pair(p.x, p.y) to (i + 1) },
            pending = null,
            imageWidth = viewModel.afterBitmap.value?.width?.toFloat() ?: 1f,
            imageHeight = viewModel.afterBitmap.value?.height?.toFloat() ?: 1f,
            color = android.graphics.Color.GREEN
        )
    }

    private fun updateButtons() {
        val total = srcPts.size
        binding.btnConfirmWarp.isEnabled = total >= 4
        binding.btnUndo.isEnabled = total > 0 || pendingSrc != null
    }

    // ── Coordinate mapping ────────────────────────────────────────────────────
    // ImageView uses CENTER_INSIDE scaling so the bitmap doesn't fill the whole
    // view. We need to map the touch position back to bitmap pixel coordinates.

    private fun touchToImageCoords(
        view: View,
        touchX: Float, touchY: Float,
        bitmapW: Int, bitmapH: Int
    ): PointF {
        val viewW = view.width.toFloat()
        val viewH = view.height.toFloat()

        // Scale factor used by CENTER_INSIDE
        val scale = minOf(viewW / bitmapW, viewH / bitmapH)

        // Offset of the image within the view (centered)
        val offsetX = (viewW - bitmapW * scale) / 2f
        val offsetY = (viewH - bitmapH * scale) / 2f

        // Map touch → bitmap pixels
        val imgX = (touchX - offsetX) / scale
        val imgY = (touchY - offsetY) / scale

        return PointF(
            imgX.coerceIn(0f, bitmapW.toFloat()),
            imgY.coerceIn(0f, bitmapH.toFloat())
        )
    }

    // ── JSON helpers ──────────────────────────────────────────────────────────

    private fun List<PointF>.toJson(): String =
        joinToString(prefix = "[", postfix = "]") { "[${it.x},${it.y}]" }
}
