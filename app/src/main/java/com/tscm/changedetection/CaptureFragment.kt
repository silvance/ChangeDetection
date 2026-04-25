package com.tscm.changedetection

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import com.tscm.changedetection.databinding.FragmentCaptureBinding
import java.nio.ByteBuffer
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CaptureFragment : Fragment() {

    private var _binding: FragmentCaptureBinding? = null
    private val binding get() = _binding!!

    private val viewModel: TscmViewModel by activityViewModels()

    private var imageCapture: ImageCapture? = null
    private lateinit var cameraExecutor: ExecutorService

    // Which slot we're filling — toggled by the Before/After buttons
    private var capturingBefore = true

    // ── Permission launcher ───────────────────────────────────────────────────

    private val requestCameraPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startCamera()
            else Toast.makeText(requireContext(), "Camera permission required", Toast.LENGTH_LONG).show()
        }

    // ── Photo picker launchers ────────────────────────────────────────────────
    // Separate launchers for Before and After so we know which slot to fill.

    private val pickBeforePhoto =
        registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            uri?.let { loadImageFromUri(it, isBefore = true) }
        }

    private val pickAfterPhoto =
        registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            uri?.let { loadImageFromUri(it, isBefore = false) }
        }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentCaptureBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        cameraExecutor = Executors.newSingleThreadExecutor()

        // Observe bitmaps for thumbnail display
        viewModel.beforeBitmap.collectOnLifecycle(viewLifecycleOwner) { bitmap ->
            binding.imgBeforeThumb.setImageBitmap(bitmap)
            binding.imgBeforeThumb.visibility = if (bitmap != null) View.VISIBLE else View.INVISIBLE
        }
        viewModel.afterBitmap.collectOnLifecycle(viewLifecycleOwner) { bitmap ->
            binding.imgAfterThumb.setImageBitmap(bitmap)
            binding.imgAfterThumb.visibility = if (bitmap != null) View.VISIBLE else View.INVISIBLE
        }

        // ── BEFORE buttons ────────────────────────────────────────────────────
        binding.btnCaptureBefore.setOnClickListener {
            capturingBefore = true
            resetButtonLabels()
            binding.btnCaptureBefore.text = getString(R.string.btn_tap_to_capture_before)
            checkCameraPermissionAndStart()
        }
        binding.btnUploadBefore.setOnClickListener {
            pickBeforePhoto.launch("image/*")
        }

        // ── AFTER buttons ─────────────────────────────────────────────────────
        binding.btnCaptureAfter.setOnClickListener {
            capturingBefore = false
            resetButtonLabels()
            binding.btnCaptureAfter.text = getString(R.string.btn_tap_to_capture_after)
            checkCameraPermissionAndStart()
        }
        binding.btnUploadAfter.setOnClickListener {
            pickAfterPhoto.launch("image/*")
        }

        // ── Shutter ───────────────────────────────────────────────────────────
        binding.btnShutter.setOnClickListener {
            takePhoto()
        }

        // ── Metadata Strip Switch ─────────────────────────────────────────────
        binding.switchStripMetadata.isChecked = viewModel.stripMetadata
        binding.switchStripMetadata.setOnCheckedChangeListener { _, isChecked ->
            viewModel.stripMetadata = isChecked
            if (isChecked) {
                Toast.makeText(requireContext(), R.string.msg_metadata_stripped, Toast.LENGTH_SHORT).show()
            }
        }

        binding.btnShutter.visibility = View.GONE
    }

    override fun onDestroyView() {
        super.onDestroyView()
        cameraExecutor.shutdown()
        _binding = null
    }

    // ── Photo upload from gallery ─────────────────────────────────────────────

    private fun loadImageFromUri(uri: Uri, isBefore: Boolean) {
        try {
            val inputStream = requireContext().contentResolver.openInputStream(uri)
                ?: throw Exception("Could not open image")
            val bytes = inputStream.readBytes()
            inputStream.close()

            if (isBefore) {
                viewModel.setBefore(bytes)
                Toast.makeText(requireContext(), getString(R.string.toast_before_loaded), Toast.LENGTH_SHORT).show()
            } else {
                viewModel.setAfter(bytes)
                Toast.makeText(requireContext(), getString(R.string.toast_after_loaded), Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            Toast.makeText(
                requireContext(),
                "Failed to load image: ${e.message}",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    // ── Camera ────────────────────────────────────────────────────────────────

    private fun checkCameraPermissionAndStart() {
        when {
            ContextCompat.checkSelfPermission(
                requireContext(), Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED -> startCamera()
            else -> requestCameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(requireContext())
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()

            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(binding.viewFinder.surfaceProvider)
            }

            imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    viewLifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    imageCapture
                )
                binding.viewFinder.visibility = View.VISIBLE
                binding.btnShutter.visibility = View.VISIBLE
            } catch (e: Exception) {
                Toast.makeText(
                    requireContext(),
                    "Camera failed: ${e.message}",
                    Toast.LENGTH_SHORT
                ).show()
            }

        }, ContextCompat.getMainExecutor(requireContext()))
    }

    private fun takePhoto() {
        val imageCapture = imageCapture ?: return

        imageCapture.takePicture(
            cameraExecutor,
            object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    val buffer: ByteBuffer = image.planes[0].buffer
                    val bytes = ByteArray(buffer.remaining())
                    buffer.get(bytes)
                    image.close()

                    if (capturingBefore) viewModel.setBefore(bytes)
                    else                 viewModel.setAfter(bytes)

                    requireActivity().runOnUiThread {
                        resetButtonLabels()
                        binding.viewFinder.visibility = View.GONE
                        binding.btnShutter.visibility = View.GONE
                        val label = if (capturingBefore) getString(R.string.label_before) else getString(R.string.label_after)
                        Toast.makeText(requireContext(), getString(R.string.toast_captured, label), Toast.LENGTH_SHORT).show()
                    }
                }

                override fun onError(exc: ImageCaptureException) {
                    requireActivity().runOnUiThread {
                        Toast.makeText(
                            requireContext(),
                            "Capture failed: ${exc.message}",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
            }
        )
    }

    private fun resetButtonLabels() {
        binding.btnCaptureBefore.text = getString(R.string.btn_camera_before)
        binding.btnCaptureAfter.text  = getString(R.string.btn_camera_after)
    }
}
