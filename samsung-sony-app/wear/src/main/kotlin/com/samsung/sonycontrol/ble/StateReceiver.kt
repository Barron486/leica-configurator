package com.samsung.sonycontrol.ble

import android.content.Context
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.samsung.sonycontrol.protocol.SonyCommand
import com.samsung.sonycontrol.protocol.SonyHeadphoneState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Listens to DataItem changes pushed by the phone and updates [SonyHeadphoneState].
 */
class StateReceiver(context: Context) : DataClient.OnDataChangedListener {

    private val dataClient = Wearable.getDataClient(context)

    private val _state = MutableStateFlow(SonyHeadphoneState())
    val state: StateFlow<SonyHeadphoneState> = _state

    fun register() = dataClient.addListener(this)
    fun unregister() = dataClient.removeListener(this)

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val path = event.dataItem.uri.path ?: continue
            if (path != "/sony/headphone_state") continue

            val map = DataMapItem.fromDataItem(event.dataItem).dataMap
            _state.value = SonyHeadphoneState(
                isConnected  = map.getBoolean("connected", false),
                deviceName   = map.getString("device_name", ""),
                batteryLevel = map.getInt("battery", -1),
                ancMode      = SonyCommand.AncMode.entries.getOrElse(map.getInt("anc_mode", 0)) {
                    SonyCommand.AncMode.OFF
                },
                ambientLevel = map.getInt("ambient_level", 10),
                volume       = map.getInt("volume", 15),
                eqPreset     = SonyCommand.EqPreset.entries.getOrElse(map.getInt("eq_preset", 0)) {
                    SonyCommand.EqPreset.OFF
                },
            )
        }
    }
}
