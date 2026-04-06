package com.samsung.sonycontrol.protocol

/**
 * Sony Headphones proprietary BLE command definitions.
 * Protocol reverse-engineered from SonyHeadphonesClient (MIT License).
 * Reference: https://github.com/Plutoberth/SonyHeadphonesClient
 */
object SonyCommand {

    // ── Protocol framing ──────────────────────────────────────────────────────
    const val START_BYTE: Byte = 0x3E
    const val END_BYTE: Byte   = 0x3C
    const val ESCAPE_BYTE: Byte = 0x3D

    // ── Data type IDs ─────────────────────────────────────────────────────────
    const val TYPE_DATA_MDR: Byte         = 0x00
    const val TYPE_DATA_MDR_NO2: Byte     = 0x0A

    // ── Command codes ─────────────────────────────────────────────────────────
    const val CMD_INIT_REQUEST: Byte         = 0x00
    const val CMD_INIT_RESPONSE: Byte        = 0x01
    const val CMD_BATTERY_LEVEL_GET: Byte    = 0x10
    const val CMD_BATTERY_LEVEL_RET: Byte    = 0x11
    const val CMD_ANC_GET: Byte              = 0x46
    const val CMD_ANC_RET: Byte             = 0x47
    const val CMD_ANC_SET: Byte             = 0x48
    const val CMD_ANC_NOTIFY: Byte          = 0x49
    const val CMD_SOUND_POSITION_GET: Byte  = 0x50
    const val CMD_SOUND_POSITION_SET: Byte  = 0x52
    const val CMD_EQ_GET: Byte              = 0x56
    const val CMD_EQ_RET: Byte             = 0x57
    const val CMD_EQ_SET: Byte             = 0x58
    const val CMD_VOLUME_GET: Byte          = 0xA0.toByte()
    const val CMD_VOLUME_SET: Byte          = 0xA2.toByte()

    // ── ANC modes ─────────────────────────────────────────────────────────────
    enum class AncMode(val value: Byte) {
        OFF(0x00),
        ANC(0x01),           // Active Noise Cancelling
        AMBIENT(0x02);       // Ambient Sound mode
    }

    // ── EQ presets ────────────────────────────────────────────────────────────
    enum class EqPreset(val value: Byte) {
        OFF(0x00),
        BRIGHT(0x01),
        EXCITED(0x02),
        MELLOW(0x03),
        RELAXED(0x04),
        VOCAL(0x05),
        TREBLE(0x06),
        BASS(0x07),
        SPEECH(0x08),
        CUSTOM(0xFF.toByte());
    }

    // ── Frame builder ─────────────────────────────────────────────────────────

    /**
     * Build a framed Sony command packet ready to send over RFCOMM/BLE.
     *
     * Frame layout:
     * [START][dataType][seqNum][payloadLen][...payload...][checksum][END]
     */
    fun buildPacket(dataType: Byte, payload: ByteArray, seqNum: Byte = 0x00): ByteArray {
        val inner = ByteArray(payload.size + 4).apply {
            this[0] = dataType
            this[1] = seqNum
            this[2] = (payload.size ushr 8 and 0xFF).toByte()
            this[3] = (payload.size and 0xFF).toByte()
            payload.copyInto(this, destinationOffset = 4)
        }
        val checksum = inner.fold(0) { acc, b -> acc + (b.toInt() and 0xFF) }.and(0xFF).toByte()

        val raw = ByteArray(inner.size + 1) { if (it < inner.size) inner[it] else checksum }
        return byteArrayOf(START_BYTE) + escape(raw) + byteArrayOf(END_BYTE)
    }

    private fun escape(data: ByteArray): ByteArray {
        val out = mutableListOf<Byte>()
        for (b in data) {
            if (b == START_BYTE || b == END_BYTE || b == ESCAPE_BYTE) {
                out.add(ESCAPE_BYTE)
                out.add((b.toInt() xor 0x01).toByte())
            } else {
                out.add(b)
            }
        }
        return out.toByteArray()
    }

    // ── Convenience payload builders ──────────────────────────────────────────

    fun ancPayload(mode: AncMode, ambientLevel: Int = 0): ByteArray {
        val level = ambientLevel.coerceIn(0, 20).toByte()
        return byteArrayOf(CMD_ANC_SET, 0x01, mode.value, level)
    }

    fun eqPayload(preset: EqPreset): ByteArray =
        byteArrayOf(CMD_EQ_SET, 0x00, preset.value)

    fun volumePayload(volume: Int): ByteArray =
        byteArrayOf(CMD_VOLUME_SET, volume.coerceIn(0, 30).toByte())

    fun batteryRequestPayload(): ByteArray =
        byteArrayOf(CMD_BATTERY_LEVEL_GET, 0x00)

    // ── Response parser ───────────────────────────────────────────────────────

    data class ParsedResponse(
        val commandCode: Byte,
        val payload: ByteArray
    )

    fun parseResponse(raw: ByteArray): ParsedResponse? {
        if (raw.size < 6) return null
        if (raw.first() != START_BYTE || raw.last() != END_BYTE) return null
        val inner = unescape(raw.slice(1 until raw.size - 1).toByteArray())
        val cmdCode = inner.getOrNull(4) ?: return null
        val payloadLen = ((inner[2].toInt() and 0xFF) shl 8) or (inner[3].toInt() and 0xFF)
        val payload = inner.slice(4 until 4 + payloadLen).toByteArray()
        return ParsedResponse(cmdCode, payload)
    }

    private fun unescape(data: ByteArray): ByteArray {
        val out = mutableListOf<Byte>()
        var i = 0
        while (i < data.size) {
            if (data[i] == ESCAPE_BYTE && i + 1 < data.size) {
                out.add((data[i + 1].toInt() xor 0x01).toByte())
                i += 2
            } else {
                out.add(data[i])
                i++
            }
        }
        return out.toByteArray()
    }
}
