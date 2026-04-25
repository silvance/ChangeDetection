package com.tscm.changedetection

import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.SeekBar
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.tscm.changedetection.databinding.FragmentAnalysisBinding
import com.tscm.changedetection.db.AppDatabase
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.ArrayList
import java.util.Date
import java.util.Locale

class AnalysisFragment : Fragment() {

    private var _binding: FragmentAnalysisBinding? = null
    private val binding get() = _binding!!

    private val viewModel: TscmViewModel by activityViewModels()
    private val db by lazy { AppDatabase.getDatabase(requireContext()) }

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentAnalysisBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        setupControls()
        observeState()

        // Show FAB once both images are loaded
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                kotlinx.coroutines.flow.combine(
                    viewModel.beforeBytes,
                    viewModel.afterBytes
                ) { before, after -> before != null && after != null }
                    .collect { hasImages ->
                        _binding?.fabAlign?.visibility =
                            if (hasImages) View.VISIBLE else View.GONE
                    }
            }
        }

        // FAB tap — open alignment dialog
        _binding?.fabAlign?.setOnClickListener {
            AlignmentFragment().show(parentFragmentManager, "alignment")
        }

        // Analyze button
        binding.btnAnalyze.setOnClickListener {
            if (!viewModel.hasImages()) {
                Toast.makeText(
                    requireContext(),
                    getString(R.string.toast_capture_both),
                    Toast.LENGTH_SHORT
                ).show()
                return@setOnClickListener
            }
            viewModel.runAnalysis()
        }

        _binding?.fabSave?.setOnClickListener {
            showSaveDialog()
        }

        _binding?.fabExport?.setOnClickListener {
            val state = viewModel.analysisState.value
            if (state is AnalysisState.Success) {
                viewModel.exportAnalysis(requireContext(), "Incident_Report")
            }
        }

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.saveStatus.collectLatest { success ->
                    if (success == true) {
                        Toast.makeText(requireContext(), "Saved to history", Toast.LENGTH_SHORT).show()
                        viewModel.resetSaveStatus()
                    }
                }
            }
        }

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.exportUris.collectLatest { uris ->
                    if (uris != null) {
                        val shareIntent = Intent().apply {
                            action = Intent.ACTION_SEND_MULTIPLE
                            putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
                            type = "image/*"
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        startActivity(Intent.createChooser(shareIntent, "Export TSCM Evidence Package"))
                        viewModel.resetExportUris()
                    }
                }
            }
        }

        // Fullscreen toggle
        binding.btnFullscreen.setOnClickListener {
            toggleFullscreen()
        }

        // Tap the ALIGNMENT ACTIVE badge to clear the active warp.
        binding.txtWarpActive.setOnClickListener {
            if (viewModel.hasActiveWarp()) {
                viewModel.clearWarp()
                binding.txtWarpActive.visibility = View.GONE
                updateFabTint(false)
                Toast.makeText(
                    requireContext(),
                    R.string.msg_alignment_cleared,
                    Toast.LENGTH_SHORT
                ).show()
            }
        }

        _binding?.magnifierView?.setup(binding.imgResult)
    }

    private var isFullscreen = false

    private fun toggleFullscreen() {
        isFullscreen = !isFullscreen
        val params = binding.imgContainer.layoutParams
        if (isFullscreen) {
            params.height = ViewGroup.LayoutParams.MATCH_PARENT
            binding.btnFullscreen.setIconResource(android.R.drawable.ic_menu_close_clear_cancel)
        } else {
            params.height = (250 * resources.displayMetrics.density).toInt()
            binding.btnFullscreen.setIconResource(android.R.drawable.ic_menu_zoom)
        }
        binding.imgContainer.layoutParams = params
    }

    private fun showSaveDialog() {
        val input = EditText(requireContext())
        input.hint = getString(R.string.hint_scan_location)
        val timestamp = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        input.setText(getString(R.string.label_scan_default, timestamp))

        AlertDialog.Builder(requireContext())
            .setTitle(R.string.dlg_save_history_title)
            .setView(input)
            .setPositiveButton(R.string.dlg_save) { _, _ ->
                val label = input.text.toString().trim()
                if (label.isEmpty()) {
                    Toast.makeText(
                        requireContext(),
                        R.string.toast_label_required,
                        Toast.LENGTH_SHORT
                    ).show()
                    return@setPositiveButton
                }
                val state = viewModel.analysisState.value
                val png = if (state is AnalysisState.Success) {
                    val stream = java.io.ByteArrayOutputStream()
                    state.highlightBitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
                    stream.toByteArray()
                } else null
                viewModel.saveCurrentToHistory(requireContext(), db, label, png)
            }
            .setNegativeButton(R.string.label_cancel, null)
            .show()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    // ── Controls ──────────────────────────────────────────────────────────────

    private fun setupControls() {

        binding.seekStrength.max = 95
        binding.seekStrength.progress = viewModel.strength - 5
        binding.lblStrength.text = getString(R.string.label_strength) + ": ${viewModel.strength}"
        binding.seekStrength.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                val value = progress + 5
                viewModel.strength = value
                binding.lblStrength.text = getString(R.string.label_strength) + ": $value"
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })

        binding.seekMorph.max = 14
        binding.seekMorph.progress = viewModel.morphSize - 1
        binding.lblMorph.text = getString(R.string.label_noise_reduction) + ": ${viewModel.morphSize}"
        binding.seekMorph.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                val value = progress + 1
                viewModel.morphSize = value
                binding.lblMorph.text = getString(R.string.label_noise_reduction) + ": $value"
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })

        binding.seekClose.max = 14
        binding.seekClose.progress = viewModel.closeSize - 1
        binding.lblClose.text = getString(R.string.label_fill_gaps) + ": ${viewModel.closeSize}"
        binding.seekClose.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                val value = progress + 1
                viewModel.closeSize = value
                binding.lblClose.text = getString(R.string.label_fill_gaps) + ": $value"
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })

        binding.switchNormalize.isChecked = viewModel.normalizeLuma
        binding.switchNormalize.setOnCheckedChangeListener { _, checked ->
            viewModel.normalizeLuma = checked
        }

        binding.seekPreBlur.max = 40
        binding.seekPreBlur.progress = (viewModel.preBlurSigma * 10).toInt()
        binding.lblPreBlur.text = getString(R.string.label_pre_blur) + ": ${viewModel.preBlurSigma}"
        binding.seekPreBlur.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                val value = progress / 10.0
                viewModel.preBlurSigma = value
                binding.lblPreBlur.text = getString(R.string.label_pre_blur) + ": $value"
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })

        binding.seekMinRegion.max = 500
        binding.seekMinRegion.progress = viewModel.minRegion
        binding.lblMinRegion.text = getString(R.string.label_min_region) + ": ${viewModel.minRegion}px"
        binding.seekMinRegion.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                viewModel.minRegion = progress
                binding.lblMinRegion.text = getString(R.string.label_min_region) + ": ${progress}px"
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })

        binding.seekOpacity.max = 100
        binding.seekOpacity.progress = (viewModel.highlightAlpha * 100).toInt()
        binding.lblOpacity.text = getString(R.string.label_highlight_opacity) + ": ${(viewModel.highlightAlpha * 100).toInt()}%"
        binding.seekOpacity.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                val value = progress / 100.0
                viewModel.highlightAlpha = value
                binding.lblOpacity.text = getString(R.string.label_highlight_opacity) + ": $progress%"
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })

        binding.btnColorRed.setOnClickListener {
            viewModel.highlightR = 255; viewModel.highlightG = 60; viewModel.highlightB = 60
        }
        binding.btnColorOrange.setOnClickListener {
            viewModel.highlightR = 255; viewModel.highlightG = 165; viewModel.highlightB = 0
        }
        binding.btnColorYellow.setOnClickListener {
            viewModel.highlightR = 255; viewModel.highlightG = 255; viewModel.highlightB = 0
        }
        binding.btnColorCyan.setOnClickListener {
            viewModel.highlightR = 0; viewModel.highlightG = 255; viewModel.highlightB = 255
        }
        binding.btnColorLime.setOnClickListener {
            viewModel.highlightR = 0; viewModel.highlightG = 255; viewModel.highlightB = 0
        }
    }

    // ── State observation ─────────────────────────────────────────────────────

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.analysisState.collect { state ->
                    when (state) {
                        is AnalysisState.Idle -> {
                            binding.progressBar.visibility = View.GONE
                            binding.btnAnalyze.isEnabled = true
                            binding.statsGroup.visibility = View.GONE

                            // Clear any previous result so the user doesn't see
                            // a stale highlight after clearing alignment or
                            // loading a new pair of images.
                            binding.imgResult.setImageDrawable(null)
                            binding.imgResult.visibility = View.GONE
                            binding.btnFullscreen.visibility = View.GONE
                            _binding?.fabSave?.visibility = View.GONE
                            _binding?.fabExport?.visibility = View.GONE
                            binding.txtResized.visibility = View.GONE

                            // Show warp active indicator if a warp is applied
                            binding.txtWarpActive.visibility =
                                if (viewModel.hasActiveWarp()) View.VISIBLE else View.GONE
                            updateFabTint(viewModel.hasActiveWarp())
                        }

                        is AnalysisState.Running -> {
                            binding.progressBar.visibility = View.VISIBLE
                            binding.btnAnalyze.isEnabled = false
                            binding.statsGroup.visibility = View.GONE
                        }

                        is AnalysisState.Success -> {
                            binding.progressBar.visibility = View.GONE
                            binding.btnAnalyze.isEnabled = true
                            _binding?.fabSave?.visibility = View.VISIBLE
                            _binding?.fabExport?.visibility = View.VISIBLE

                            binding.imgResult.setImageBitmap(state.highlightBitmap)
                            binding.imgResult.visibility = View.VISIBLE
                            binding.btnFullscreen.visibility = View.VISIBLE
                            
                            _binding?.magnifierView?.setBitmap(state.highlightBitmap)

                            binding.statsGroup.visibility = View.VISIBLE
                            binding.txtChangedPct.text = getString(R.string.label_change_pct, state.changedPct.toInt())
                            binding.txtChangedPx.text = getString(R.string.label_change_px, state.changedPixels)
                            binding.txtRegions.text = getString(R.string.label_regions, state.regions)

                            binding.txtResized.visibility =
                                if (state.resized) View.VISIBLE else View.GONE

                            binding.txtWarpActive.visibility =
                                if (viewModel.hasActiveWarp()) View.VISIBLE else View.GONE
                            updateFabTint(viewModel.hasActiveWarp())
                        }

                        is AnalysisState.Error -> {
                            binding.progressBar.visibility = View.GONE
                            binding.btnAnalyze.isEnabled = true
                            Toast.makeText(
                                requireContext(),
                                "Error: ${state.message}",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                    }
                }
            }
        }
    }

    // ── FAB tint ──────────────────────────────────────────────────────────────
    // Turns cyan when alignment is active, matches the web app's solid blue FAB.

    private fun updateFabTint(warpActive: Boolean) {
        val color = if (warpActive) {
            android.graphics.Color.parseColor("#00E5FF")  // cyan = active
        } else {
            android.graphics.Color.parseColor("#1A1A1A")  // dark = inactive
        }
        _binding?.fabAlign?.backgroundTintList =
            android.content.res.ColorStateList.valueOf(color)
    }
}
