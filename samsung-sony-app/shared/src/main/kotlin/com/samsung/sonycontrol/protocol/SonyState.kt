package com.samsung.sonycontrol.protocol

/** Snapshot of headphone state synced between phone and watch. */
data class SonyHeadphoneState(
    val isConnected: Boolean = false,
    val deviceName: String = "",
    val batteryLevel: Int = -1,       // 0-100, -1 = unknown
    val ancMode: SonyCommand.AncMode = SonyCommand.AncMode.OFF,
    val ambientLevel: Int = 10,       // 0-20
    val volume: Int = 15,             // 0-30
    val eqPreset: SonyCommand.EqPreset = SonyCommand.EqPreset.OFF,
)

/** Commands sent from Watch → Phone via Wearable Data Layer. */
sealed class WatchCommand {
    data class SetAnc(val mode: SonyCommand.AncMode, val ambientLevel: Int = 10) : WatchCommand()
    data class SetVolume(val volume: Int) : WatchCommand()
    data class SetEq(val preset: SonyCommand.EqPreset) : WatchCommand()
    object RequestState : WatchCommand()
}

object WatchCommandSerializer {
    fun serialize(cmd: WatchCommand): ByteArray = when (cmd) {
        is WatchCommand.SetAnc ->
            byteArrayOf(0x01, cmd.mode.ordinal.toByte(), cmd.ambientLevel.toByte())
        is WatchCommand.SetVolume ->
            byteArrayOf(0x02, cmd.volume.toByte())
        is WatchCommand.SetEq ->
            byteArrayOf(0x03, cmd.preset.ordinal.toByte())
        is WatchCommand.RequestState ->
            byteArrayOf(0x00)
    }

    fun deserialize(data: ByteArray): WatchCommand? = when (data.getOrNull(0)) {
        0x00.toByte() -> WatchCommand.RequestState
        0x01.toByte() -> {
            val mode = SonyCommand.AncMode.entries.getOrNull(data[1].toInt() and 0xFF)
                ?: return null
            WatchCommand.SetAnc(mode, data.getOrNull(2)?.toInt() ?: 10)
        }
        0x02.toByte() -> WatchCommand.SetVolume(data[1].toInt() and 0xFF)
        0x03.toByte() -> {
            val preset = SonyCommand.EqPreset.entries.getOrNull(data[1].toInt() and 0xFF)
                ?: return null
            WatchCommand.SetEq(preset)
        }
        else -> null
    }
}
