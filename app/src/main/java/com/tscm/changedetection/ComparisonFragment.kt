package com.tscm.changedetection

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.tscm.changedetection.databinding.FragmentComparisonBinding
import kotlinx.coroutines.launch

class ComparisonFragment : Fragment() {

    private var _binding: FragmentComparisonBinding? = null
    private val binding get() = _binding!!

    private val viewModel: TscmViewModel by activityViewModels()

    // ── Auto-flicker state ────────────────────────────────────────────────────
    private val flickerHandler = Handler(Looper.getMainLooper())
    private var flickerRunnable: Runnable? = null
    private var showingBefore = true
    private var flickerSpeedMs = 500L  // default 500ms

    // ── View modes ────────────────────────────────────────────────────────────
    enum class Mode { SLIDER, TOGGLE, AUTO }
    private var currentMode = Mode.SLIDER

    // ── Toggle state ──────────────────────────────────────────────────────────
    private var toggleShowingBefore = true

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentComparisonBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("currentMode", currentMode.name)
        outState.putLong("flickerSpeedMs", flickerSpeedMs)
        outState.putBoolean("toggleShowingBefore", toggleShowingBefore)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        savedInstanceState?.let {
            currentMode = Mode.valueOf(it.getString("currentMode", Mode.SLIDER.name))
            flickerSpeedMs = it.getLong("flickerSpeedMs", 500L)
            toggleShowingBefore = it.getBoolean("toggleShowingBefore", true)
        }

        setupModeButtons()
        setupOrientationButtons()
        setupToggleButtons()
        setupSpeedSlider()
        observeBitmaps()
        observeAnalysisResults()

        showMode(currentMode)
    }

    private fun observeAnalysisResults() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.analysisState.collect { state ->
                    if (state is AnalysisState.Success) {
                        binding.valChangedPct.text = "${state.changedPct.toInt()}%"
                        binding.valChangedPx.text = state.changedPixels.toString()
                        binding.valRegions.text = state.regions.toString()
                    }
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        stopFlicker()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        stopFlicker()
        _binding = null
    }

    // ── Mode buttons (Slider / Toggle / Auto) ─────────────────────────────────

    private fun setupModeButtons() {
        binding.btnModeSlider.setOnClickListener { showMode(Mode.SLIDER) }
        binding.btnModeToggle.setOnClickListener { showMode(Mode.TOGGLE) }
        binding.btnModeAuto.setOnClickListener   { showMode(Mode.AUTO) }
    }

    private fun showMode(mode: Mode) {
        currentMode = mode
        stopFlicker()

        // Update button highlight
        val activeColor = requireContext().getColor(R.color.tscm_primary)
        val inactiveColor = android.graphics.Color.TRANSPARENT
        binding.btnModeSlider.backgroundTintList = android.content.res.ColorStateList.valueOf(
            if (mode == Mode.SLIDER) activeColor else inactiveColor)
        binding.btnModeToggle.backgroundTintList = android.content.res.ColorStateList.valueOf(
            if (mode == Mode.TOGGLE) activeColor else inactiveColor)
        binding.btnModeAuto.backgroundTintList = android.content.res.ColorStateList.valueOf(
            if (mode == Mode.AUTO) activeColor else inactiveColor)

        // Show/hide relevant panels
        binding.splitView.visibility    = if (mode == Mode.SLIDER) View.VISIBLE else View.GONE
        binding.orientationRow.visibility = if (mode == Mode.SLIDER) View.VISIBLE else View.GONE
        binding.toggleContainer.visibility = if (mode == Mode.TOGGLE || mode == Mode.AUTO) View.VISIBLE else View.GONE
        binding.toggleImageView.visibility = if (mode == Mode.TOGGLE || mode == Mode.AUTO) View.VISIBLE else View.GONE
        binding.toggleButtons.visibility  = if (mode == Mode.TOGGLE) View.VISIBLE else View.GONE
        binding.autoControls.visibility   = if (mode == Mode.AUTO) View.VISIBLE else View.GONE

        when (mode) {
            Mode.SLIDER -> refreshSplitView()
            Mode.TOGGLE -> showToggleImage(toggleShowingBefore)
            Mode.AUTO   -> startFlicker()
        }
    }

    // ── Orientation (Horizontal / Vertical) ───────────────────────────────────

    private fun setupOrientationButtons() {
        binding.btnOrientHorizontal.setOnClickListener {
            binding.splitView.orientation = SplitImageView.Orientation.HORIZONTAL
            highlightOrientation(horizontal = true)
        }
        binding.btnOrientVertical.setOnClickListener {
            binding.splitView.orientation = SplitImageView.Orientation.VERTICAL
            highlightOrientation(horizontal = false)
        }
        highlightOrientation(horizontal = true)
    }

    private fun highlightOrientation(horizontal: Boolean) {
        val activeColor = requireContext().getColor(R.color.tscm_primary)
        val inactiveColor = android.graphics.Color.TRANSPARENT
        binding.btnOrientHorizontal.backgroundTintList = android.content.res.ColorStateList.valueOf(
            if (horizontal) activeColor else inactiveColor)
        binding.btnOrientVertical.backgroundTintList = android.content.res.ColorStateList.valueOf(
            if (!horizontal) activeColor else inactiveColor)
    }

    // ── Toggle mode buttons (Before / After / ↔) ─────────────────────────────

    private fun setupToggleButtons() {
        binding.btnToggleBefore.setOnClickListener {
            toggleShowingBefore = true
            showToggleImage(true)
        }
        binding.btnToggleAfter.setOnClickListener {
            toggleShowingBefore = false
            showToggleImage(false)
        }
        binding.btnToggleSwap.setOnClickListener {
            toggleShowingBefore = !toggleShowingBefore
            showToggleImage(toggleShowingBefore)
        }
    }

    private fun showToggleImage(before: Boolean) {
        val bitmap = if (before) viewModel.beforeBitmap.value
                     else        viewModel.afterBitmap.value
        binding.toggleImageView.setImageBitmap(bitmap)

        val label = if (before) getString(R.string.label_before) else getString(R.string.label_after)
        binding.txtToggleLabel.text = label
    }

    // ── Auto flicker ──────────────────────────────────────────────────────────

    private fun setupSpeedSlider() {
        // SeekBar 0–19 maps to 100ms–2000ms in steps of ~100ms
        binding.seekFlickerSpeed.max = 19
        binding.seekFlickerSpeed.progress = ((flickerSpeedMs - 100) / 100).toInt().coerceIn(0, 19)
        binding.lblFlickerSpeed.text = getString(R.string.label_flicker_interval, flickerSpeedMs)

        binding.seekFlickerSpeed.setOnSeekBarChangeListener(
            object : android.widget.SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(
                    sb: android.widget.SeekBar, progress: Int, fromUser: Boolean
                ) {
                    flickerSpeedMs = (100 + progress * 100).toLong()
                    binding.lblFlickerSpeed.text = getString(R.string.label_flicker_interval, flickerSpeedMs)
                    if (currentMode == Mode.AUTO) {
                        stopFlicker()
                        startFlicker()
                    }
                }
                override fun onStartTrackingTouch(sb: android.widget.SeekBar) {}
                override fun onStopTrackingTouch(sb: android.widget.SeekBar) {}
            })
    }

    private fun startFlicker() {
        showingBefore = true
        val runnable = object : Runnable {
            override fun run() {
                if (_binding == null) return
                val bitmap = if (showingBefore) viewModel.beforeBitmap.value
                             else               viewModel.afterBitmap.value
                binding.toggleImageView.setImageBitmap(bitmap)
                binding.txtToggleLabel.text = if (showingBefore) getString(R.string.label_before) else getString(R.string.label_after)
                showingBefore = !showingBefore
                flickerHandler.postDelayed(this, flickerSpeedMs)
            }
        }
        flickerRunnable = runnable
        flickerHandler.post(runnable)
    }

    private fun stopFlicker() {
        flickerRunnable?.let { flickerHandler.removeCallbacks(it) }
        flickerRunnable = null
    }

    // ── Bitmap observation ────────────────────────────────────────────────────

    private fun observeBitmaps() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.beforeBitmap.collect { refreshSplitView() }
            }
        }
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.afterBitmap.collect { refreshSplitView() }
            }
        }
    }

    private fun refreshSplitView() {
        binding.splitView.setBitmaps(
            viewModel.beforeBitmap.value,
            viewModel.afterBitmap.value
        )
        // Also refresh toggle if active
        if (currentMode == Mode.TOGGLE) showToggleImage(toggleShowingBefore)
    }
}
