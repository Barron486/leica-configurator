package com.samsung.sonycontrol.ble

import android.content.Context
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.Wearable
import com.samsung.sonycontrol.protocol.WatchCommand
import com.samsung.sonycontrol.protocol.WatchCommandSerializer
import kotlinx.coroutines.tasks.await

/**
 * Sends commands from the watch to the paired phone via the Wearable Message API.
 */
class WatchCommandSender(private val context: Context) {

    private val messageClient = Wearable.getMessageClient(context)
    private val nodeClient = Wearable.getNodeClient(context)

    suspend fun send(command: WatchCommand) {
        val nodes = nodeClient.connectedNodes.await()
        val phoneNode = nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull() ?: return
        messageClient.sendMessage(
            phoneNode.id,
            "/sony/command",
            WatchCommandSerializer.serialize(command)
        ).await()
    }

    suspend fun connectHeadphone(macAddress: String) {
        val nodes = nodeClient.connectedNodes.await()
        val phoneNode = nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull() ?: return
        messageClient.sendMessage(
            phoneNode.id,
            "/sony/connect",
            macAddress.toByteArray(Charsets.UTF_8)
        ).await()
    }
}
