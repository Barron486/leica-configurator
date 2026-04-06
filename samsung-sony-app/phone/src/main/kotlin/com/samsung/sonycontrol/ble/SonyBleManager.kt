package com.samsung.sonycontrol.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import com.samsung.sonycontrol.protocol.SonyCommand
import com.samsung.sonycontrol.protocol.SonyHeadphoneState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

/**
 * Manages Classic Bluetooth (RFCOMM) connection to Sony headphones.
 * Sony headphones expose an SPP (Serial Port Profile) service.
 */
class SonyBleManager(private val context: Context) {

    // Sony MDR headphones use a proprietary UUID for their SPP service.
    private val SONY_SPP_UUID = UUID.fromString("96CC203E-5068-46ad-B32D-E316F5E069BA")

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var socket: BluetoothSocket? = null
    private var inputStream: InputStream? = null
    private var outputStream: OutputStream? = null

    private val _state = MutableStateFlow(SonyHeadphoneState())
    val state: StateFlow<SonyHeadphoneState> = _state

    // ── Connection ────────────────────────────────────────────────────────────

    fun connect(deviceAddress: String) {
        scope.launch {
            val adapter = BluetoothAdapter.getDefaultAdapter() ?: return@launch
            val device: BluetoothDevice = adapter.getRemoteDevice(deviceAddress)

            runCatching {
                adapter.cancelDiscovery()
                val s = device.createRfcommSocketToServiceRecord(SONY_SPP_UUID)
                s.connect()
                socket = s
                inputStream = s.inputStream
                outputStream = s.outputStream
                _state.value = _state.value.copy(isConnected = true, deviceName = device.name ?: deviceAddress)
                sendInitHandshake()
                requestBattery()
                listenForResponses()
            }.onFailure {
                _state.value = _state.value.copy(isConnected = false)
            }
        }
    }

    fun disconnect() {
        runCatching { socket?.close() }
        socket = null
        _state.value = _state.value.copy(isConnected = false)
    }

    // ── Command sending ───────────────────────────────────────────────────────

    fun setAnc(mode: SonyCommand.AncMode, ambientLevel: Int = 10) {
        val payload = SonyCommand.ancPayload(mode, ambientLevel)
        sendPacket(SonyCommand.TYPE_DATA_MDR, payload)
        _state.value = _state.value.copy(ancMode = mode, ambientLevel = ambientLevel)
    }

    fun setVolume(volume: Int) {
        val payload = SonyCommand.volumePayload(volume)
        sendPacket(SonyCommand.TYPE_DATA_MDR, payload)
        _state.value = _state.value.copy(volume = volume)
    }

    fun setEq(preset: SonyCommand.EqPreset) {
        val payload = SonyCommand.eqPayload(preset)
        sendPacket(SonyCommand.TYPE_DATA_MDR, payload)
        _state.value = _state.value.copy(eqPreset = preset)
    }

    private fun requestBattery() {
        sendPacket(SonyCommand.TYPE_DATA_MDR, SonyCommand.batteryRequestPayload())
    }

    private fun sendInitHandshake() {
        sendPacket(SonyCommand.TYPE_DATA_MDR, byteArrayOf(SonyCommand.CMD_INIT_REQUEST, 0x00))
    }

    private fun sendPacket(dataType: Byte, payload: ByteArray) {
        scope.launch {
            runCatching {
                outputStream?.write(SonyCommand.buildPacket(dataType, payload))
                outputStream?.flush()
            }
        }
    }

    // ── Response loop ─────────────────────────────────────────────────────────

    private suspend fun listenForResponses() = withContext(Dispatchers.IO) {
        val buffer = mutableListOf<Byte>()
        val tmp = ByteArray(1024)
        while (socket?.isConnected == true) {
            val n = runCatching { inputStream?.read(tmp) ?: -1 }.getOrDefault(-1)
            if (n <= 0) break
            for (i in 0 until n) buffer.add(tmp[i])

            // Extract complete frames delimited by END_BYTE
            val endIdx = buffer.lastIndexOf(SonyCommand.END_BYTE)
            val startIdx = buffer.indexOf(SonyCommand.START_BYTE)
            if (startIdx >= 0 && endIdx > startIdx) {
                val frame = buffer.subList(startIdx, endIdx + 1).toByteArray()
                buffer.clear()
                processFrame(frame)
            }
        }
        _state.value = _state.value.copy(isConnected = false)
    }

    private fun processFrame(frame: ByteArray) {
        val response = SonyCommand.parseResponse(frame) ?: return
        when (response.commandCode) {
            SonyCommand.CMD_BATTERY_LEVEL_RET -> {
                val level = response.payload.getOrNull(1)?.toInt()?.and(0xFF) ?: return
                _state.value = _state.value.copy(batteryLevel = level)
            }
            SonyCommand.CMD_ANC_RET, SonyCommand.CMD_ANC_NOTIFY -> {
                val modeOrd = response.payload.getOrNull(1)?.toInt()?.and(0xFF) ?: return
                val mode = SonyCommand.AncMode.entries.getOrNull(modeOrd) ?: return
                val amb = response.payload.getOrNull(2)?.toInt()?.and(0xFF) ?: 0
                _state.value = _state.value.copy(ancMode = mode, ambientLevel = amb)
            }
        }
    }
}
