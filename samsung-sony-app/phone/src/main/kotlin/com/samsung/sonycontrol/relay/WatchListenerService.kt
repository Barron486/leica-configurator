package com.samsung.sonycontrol.relay

import android.content.Intent
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import com.samsung.sonycontrol.ble.SonyBleManager
import com.samsung.sonycontrol.protocol.WatchCommand
import com.samsung.sonycontrol.protocol.WatchCommandSerializer

/**
 * Receives messages from the Samsung Watch via the Wearable Data Layer API
 * and forwards them to the Sony headphones via Bluetooth.
 *
 * Message paths:
 *   /sony/command  – WatchCommand bytes
 *   /sony/connect  – device MAC address (UTF-8)
 */
class WatchListenerService : WearableListenerService() {

    companion object {
        const val PATH_COMMAND = "/sony/command"
        const val PATH_CONNECT = "/sony/connect"
        const val PATH_STATE   = "/sony/state"

        // Singleton BLE manager shared with MainActivity
        lateinit var bleManager: SonyBleManager
    }

    override fun onCreate() {
        super.onCreate()
        bleManager = SonyBleManager(applicationContext)
    }

    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            PATH_CONNECT -> {
                val address = String(event.data, Charsets.UTF_8)
                bleManager.connect(address)
            }
            PATH_COMMAND -> {
                val cmd = WatchCommandSerializer.deserialize(event.data) ?: return
                handleCommand(cmd)
            }
        }
    }

    private fun handleCommand(cmd: WatchCommand) {
        when (cmd) {
            is WatchCommand.SetAnc     -> bleManager.setAnc(cmd.mode, cmd.ambientLevel)
            is WatchCommand.SetVolume  -> bleManager.setVolume(cmd.volume)
            is WatchCommand.SetEq      -> bleManager.setEq(cmd.preset)
            is WatchCommand.RequestState -> {
                // State is pushed back automatically via StateSync in MainActivity
            }
        }
    }
}
