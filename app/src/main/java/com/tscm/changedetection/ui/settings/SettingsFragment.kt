package com.tscm.changedetection.ui.settings

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.tscm.changedetection.R
import com.tscm.changedetection.databinding.FragmentSettingsBinding
import com.tscm.changedetection.pairing.PairingPrefs
import com.tscm.changedetection.pairing.PixelSentinelClient
import kotlinx.coroutines.launch

/**
 * Settings tab — currently just the PixelSentinel desktop pairing config.
 * Users paste the desktop's URL and the pairing token printed at startup,
 * then "Test connection" to confirm.
 */
class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!

    private val prefs by lazy { PairingPrefs.get(requireContext()) }

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.editHost.setText(prefs.host)
        binding.editToken.setText(prefs.token)

        binding.btnSave.setOnClickListener { savePairing(showStatus = true) }
        binding.btnTest.setOnClickListener { testPairing() }
    }

    private fun savePairing(showStatus: Boolean) {
        val host = binding.editHost.text?.toString().orEmpty().trim().trimEnd('/')
        val token = binding.editToken.text?.toString().orEmpty().trim()
        if (host.isEmpty() || token.isEmpty()) {
            setStatus(getString(R.string.msg_pairing_incomplete), error = true)
            return
        }
        if (!host.startsWith("http://") && !host.startsWith("https://")) {
            setStatus(getString(R.string.msg_pairing_bad_scheme), error = true)
            return
        }
        prefs.host = host
        prefs.token = token
        if (showStatus) {
            setStatus(getString(R.string.msg_pairing_saved), error = false)
        }
    }

    private fun testPairing() {
        savePairing(showStatus = false)
        if (!prefs.isConfigured) {
            setStatus(getString(R.string.msg_pairing_incomplete), error = true)
            return
        }
        setStatus(getString(R.string.msg_pairing_testing), error = false)
        viewLifecycleOwner.lifecycleScope.launch {
            val result = PixelSentinelClient.fetchInfo(prefs.host)
            result.fold(
                onSuccess = { info ->
                    setStatus(
                        getString(R.string.msg_pairing_ok, info.name, info.version),
                        error = false
                    )
                },
                onFailure = { e ->
                    setStatus(
                        getString(R.string.msg_pairing_failed, e.message ?: "?"),
                        error = true
                    )
                }
            )
        }
    }

    private fun setStatus(text: String, error: Boolean) {
        if (_binding == null) return
        binding.txtPairingStatus.text = text
        binding.txtPairingStatus.visibility = View.VISIBLE
        val color = if (error) android.graphics.Color.parseColor("#CF6679")
                    else android.graphics.Color.parseColor("#00E5FF")
        binding.txtPairingStatus.setTextColor(color)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
