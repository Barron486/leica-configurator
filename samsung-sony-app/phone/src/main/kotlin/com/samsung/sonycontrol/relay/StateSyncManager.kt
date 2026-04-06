package com.samsung.sonycontrol.relay

import android.content.Context
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.samsung.sonycontrol.protocol.SonyHeadphoneState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * Observes [SonyHeadphoneState] and pushes it to the watch via the
 * Wearable DataItem API whenever it changes.
 *
 * DataItem path: /sony/headphone_state
 */
class StateSyncManager(
    private val context: Context,
    private val stateFlow: StateFlow<SonyHeadphoneState>
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val dataClient = Wearable.getDataClient(context)

    fun start() {
        scope.launch {
            stateFlow.distinctUntilChanged().collect { state ->
                pushStateToWatch(state)
            }
        }
    }

    private suspend fun pushStateToWatch(state: SonyHeadphoneState) {
        runCatching {
            val request = PutDataMapRequest.create("/sony/headphone_state").apply {
                dataMap.putBoolean("connected", state.isConnected)
                dataMap.putString("device_name", state.deviceName)
                dataMap.putInt("battery", state.batteryLevel)
                dataMap.putInt("anc_mode", state.ancMode.ordinal)
                dataMap.putInt("ambient_level", state.ambientLevel)
                dataMap.putInt("volume", state.volume)
                dataMap.putInt("eq_preset", state.eqPreset.ordinal)
                dataMap.putLong("timestamp", System.currentTimeMillis())
            }.asPutDataRequest().setUrgent()
            dataClient.putDataItem(request).await()
        }
    }
}
