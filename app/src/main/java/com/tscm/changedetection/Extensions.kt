package com.tscm.changedetection

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

// Convenience extension so Fragments can collect Flows without boilerplate.
// Usage: someFlow.collectOnLifecycle(viewLifecycleOwner) { value -> ... }
fun <T> Flow<T>.collectOnLifecycle(
    owner: LifecycleOwner,
    state: Lifecycle.State = Lifecycle.State.STARTED,
    block: suspend (T) -> Unit
) {
    owner.lifecycleScope.launch {
        owner.repeatOnLifecycle(state) {
            collect { block(it) }
        }
    }
}
