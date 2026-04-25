package com.tscm.changedetection

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.tscm.changedetection.databinding.FragmentAlternateBinding
import kotlinx.coroutines.launch

class AlternateAnalysisFragment : Fragment() {

    private var _binding: FragmentAlternateBinding? = null
    private val binding get() = _binding!!

    private val viewModel: TscmViewModel by activityViewModels()

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentAlternateBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.btnRunAlternate.setOnClickListener {
            if (!viewModel.hasImages()) {
                Toast.makeText(
                    requireContext(),
                    getString(R.string.toast_capture_both),
                    Toast.LENGTH_SHORT
                ).show()
                return@setOnClickListener
            }
            viewModel.runAlternateAnalysis()
        }

        observeState()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.alternateState.collect { state ->
                    when (state) {
                        is AlternateState.Idle -> {
                            binding.progressBar.visibility = View.GONE
                            binding.btnRunAlternate.isEnabled = true
                            binding.resultsGrid.visibility = View.GONE
                        }

                        is AlternateState.Running -> {
                            binding.progressBar.visibility = View.VISIBLE
                            binding.btnRunAlternate.isEnabled = false
                            binding.resultsGrid.visibility = View.GONE
                        }

                        is AlternateState.Success -> {
                            binding.progressBar.visibility = View.GONE
                            binding.btnRunAlternate.isEnabled = true
                            binding.resultsGrid.visibility = View.VISIBLE

                            // Labels match the web app's Alternate Analysis tab
                            binding.cardDiff.imgMain.setImageBitmap(state.diffBitmap)
                            binding.cardDiff.lblTitle.text = getString(R.string.label_img_diff)

                            binding.cardSubtraction.imgMain.setImageBitmap(state.subtractionBitmap)
                            binding.cardSubtraction.lblTitle.text = getString(R.string.label_channel_sub)

                            binding.cardHeatmap.imgMain.setImageBitmap(state.heatmapBitmap)
                            binding.cardHeatmap.lblTitle.text = getString(R.string.label_intensity_heat)

                            binding.cardCanny.imgMain.setImageBitmap(state.cannyBitmap)
                            binding.cardCanny.lblTitle.text = getString(R.string.label_canny_edges)

                            binding.imgContours.setImageBitmap(state.contoursBitmap)
                            binding.lblContours.text = getString(R.string.label_contour_overlay)
                        }


                        is AlternateState.Error -> {
                            binding.progressBar.visibility = View.GONE
                            binding.btnRunAlternate.isEnabled = true
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
}
