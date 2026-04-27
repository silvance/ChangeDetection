package com.tscm.changedetection.pairing

import android.content.Context
import android.content.SharedPreferences

/**
 * Lightweight wrapper around the SharedPreferences-backed PixelSentinel
 * desktop pairing config. The phone needs two things to talk to a desktop
 * instance over LAN: where to reach it, and what token to present.
 */
class PairingPrefs private constructor(private val prefs: SharedPreferences) {

    var host: String
        get() = prefs.getString(KEY_HOST, "")?.trim().orEmpty()
        set(value) {
            prefs.edit().putString(KEY_HOST, value.trim().trimEnd('/')).apply()
        }

    var token: String
        get() = prefs.getString(KEY_TOKEN, "")?.trim().orEmpty()
        set(value) {
            prefs.edit().putString(KEY_TOKEN, value.trim()).apply()
        }

    val isConfigured: Boolean
        get() = host.isNotEmpty() && token.isNotEmpty()

    companion object {
        private const val PREFS = "pixelsentinel_pairing"
        private const val KEY_HOST = "host"
        private const val KEY_TOKEN = "token"

        fun get(context: Context): PairingPrefs =
            PairingPrefs(context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE))
    }
}
