package com.samsung.sonycontrol.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.wear.compose.material.*
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.samsung.sonycontrol.ble.StateReceiver
import com.samsung.sonycontrol.ble.WatchCommandSender
import com.samsung.sonycontrol.protocol.SonyCommand
import com.samsung.sonycontrol.protocol.SonyHeadphoneState
import com.samsung.sonycontrol.protocol.WatchCommand
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class WearViewModel : ViewModel() {
    lateinit var sender: WatchCommandSender
    lateinit var receiver: StateReceiver

    val state: StateFlow<SonyHeadphoneState> get() = receiver.state

    fun sendAnc(mode: SonyCommand.AncMode) = viewModelScope.launch {
        sender.send(WatchCommand.SetAnc(mode))
    }

    fun sendVolume(v: Int) = viewModelScope.launch {
        sender.send(WatchCommand.SetVolume(v))
    }

    fun sendEq(preset: SonyCommand.EqPreset) = viewModelScope.launch {
        sender.send(WatchCommand.SetEq(preset))
    }
}

class WearMainActivity : ComponentActivity() {

    private val vm: WearViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm.sender = WatchCommandSender(applicationContext)
        vm.receiver = StateReceiver(applicationContext)

        setContent {
            WearApp(vm)
        }
    }

    override fun onResume() {
        super.onResume()
        vm.receiver.register()
    }

    override fun onPause() {
        super.onPause()
        vm.receiver.unregister()
    }
}

@Composable
fun WearApp(vm: WearViewModel) {
    val state by vm.state.collectAsState()

    MaterialTheme {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            contentPadding = PaddingValues(vertical = 20.dp)
        ) {
            // Header
            item {
                Text(
                    text = if (state.isConnected) state.deviceName else "Not Connected",
                    fontSize = 14.sp,
                    modifier = Modifier.padding(bottom = 4.dp)
                )
            }

            // Battery
            if (state.isConnected && state.batteryLevel >= 0) {
                item {
                    Text("Battery: ${state.batteryLevel}%", fontSize = 12.sp)
                }
            }

            // ANC Control
            item { SectionLabel("Noise Control") }

            item {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AncButton("ANC", state.ancMode == SonyCommand.AncMode.ANC) {
                        vm.sendAnc(SonyCommand.AncMode.ANC)
                    }
                    AncButton("AMB", state.ancMode == SonyCommand.AncMode.AMBIENT) {
                        vm.sendAnc(SonyCommand.AncMode.AMBIENT)
                    }
                    AncButton("OFF", state.ancMode == SonyCommand.AncMode.OFF) {
                        vm.sendAnc(SonyCommand.AncMode.OFF)
                    }
                }
            }

            // Volume
            item { SectionLabel("Volume: ${state.volume}") }

            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { if (state.volume > 0) vm.sendVolume(state.volume - 1) },
                        modifier = Modifier.size(40.dp)
                    ) { Text("-") }
                    Button(
                        onClick = { if (state.volume < 30) vm.sendVolume(state.volume + 1) },
                        modifier = Modifier.size(40.dp)
                    ) { Text("+") }
                }
            }

            // EQ
            item { SectionLabel("EQ") }

            item {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    EqChip("OFF",   state.eqPreset == SonyCommand.EqPreset.OFF)   { vm.sendEq(SonyCommand.EqPreset.OFF) }
                    EqChip("BASS",  state.eqPreset == SonyCommand.EqPreset.BASS)  { vm.sendEq(SonyCommand.EqPreset.BASS) }
                    EqChip("VOCAL", state.eqPreset == SonyCommand.EqPreset.VOCAL) { vm.sendEq(SonyCommand.EqPreset.VOCAL) }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, fontSize = 11.sp, color = MaterialTheme.colors.secondary)
}

@Composable
private fun AncButton(label: String, selected: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(
            backgroundColor = if (selected)
                MaterialTheme.colors.primary
            else
                MaterialTheme.colors.surface
        ),
        modifier = Modifier.size(width = 48.dp, height = 32.dp)
    ) {
        Text(label, fontSize = 9.sp)
    }
}

@Composable
private fun EqChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Chip(
        label = { Text(label, fontSize = 9.sp) },
        onClick = onClick,
        colors = ChipDefaults.chipColors(
            backgroundColor = if (selected)
                MaterialTheme.colors.primary
            else
                MaterialTheme.colors.surface
        ),
        modifier = Modifier.height(28.dp)
    )
}
