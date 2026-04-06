package com.samsung.sonycontrol.ui

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.samsung.sonycontrol.ble.SonyBleManager
import com.samsung.sonycontrol.protocol.SonyHeadphoneState
import com.samsung.sonycontrol.relay.StateSyncManager
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

class MainViewModel : ViewModel() {
    lateinit var bleManager: SonyBleManager
    lateinit var stateSyncManager: StateSyncManager
    val state: StateFlow<SonyHeadphoneState> by lazy {
        bleManager.state.stateIn(viewModelScope, SharingStarted.Eagerly, SonyHeadphoneState())
    }
}

class MainActivity : ComponentActivity() {

    private val vm: MainViewModel by viewModels()

    private val btPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* handle result */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        vm.bleManager = SonyBleManager(applicationContext)
        vm.stateSyncManager = StateSyncManager(applicationContext, vm.bleManager.state)
        vm.stateSyncManager.start()

        requestBtPermissionsIfNeeded()

        setContent {
            MaterialTheme {
                PhoneMainScreen(
                    stateFlow = vm.state,
                    onConnectDevice = { address -> vm.bleManager.connect(address) },
                    onDisconnect = { vm.bleManager.disconnect() }
                )
            }
        }
    }

    private fun requestBtPermissionsIfNeeded() {
        val needed = mutableListOf<String>()
        val perms = listOf(
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.BLUETOOTH_SCAN
        )
        for (p in perms) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED)
                needed.add(p)
        }
        if (needed.isNotEmpty()) btPermissionLauncher.launch(needed.toTypedArray())
    }
}

@Composable
fun PhoneMainScreen(
    stateFlow: StateFlow<SonyHeadphoneState>,
    onConnectDevice: (String) -> Unit,
    onDisconnect: () -> Unit
) {
    val state by stateFlow.collectAsState()
    val pairedDevices = remember { getPairedSonyDevices() }

    Scaffold(topBar = { TopAppBar(title = { Text("Sony Headphones Control") }) }) { padding ->
        Column(
            modifier = Modifier.padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Connection status
            StatusCard(state)

            // Paired device list (if not connected)
            if (!state.isConnected) {
                Text("Select headphones:", style = MaterialTheme.typography.titleSmall)
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(pairedDevices) { device ->
                        DeviceRow(device) { onConnectDevice(device.address) }
                    }
                }
            } else {
                Button(onClick = onDisconnect, colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error
                )) {
                    Text("Disconnect")
                }
                Text(
                    "Control via Samsung Watch app or use buttons below.",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
private fun StatusCard(state: SonyHeadphoneState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                if (state.isConnected) "Connected: ${state.deviceName}" else "Not connected",
                style = MaterialTheme.typography.titleMedium
            )
            if (state.isConnected) {
                Text("Battery: ${if (state.batteryLevel >= 0) "${state.batteryLevel}%" else "Unknown"}")
                Text("ANC: ${state.ancMode.name}")
                Text("Volume: ${state.volume}")
                Text("EQ: ${state.eqPreset.name}")
            }
        }
    }
}

@Composable
private fun DeviceRow(device: BluetoothDevice, onClick: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(device.name ?: "Unknown", style = MaterialTheme.typography.bodyLarge)
                Text(device.address, style = MaterialTheme.typography.bodySmall)
            }
            Icon(
                androidx.compose.material.icons.Icons.Default.Headset,
                contentDescription = null
            )
        }
    }
}

private fun getPairedSonyDevices(): List<BluetoothDevice> {
    return runCatching {
        BluetoothAdapter.getDefaultAdapter()
            ?.bondedDevices
            ?.filter { it.name?.contains("Sony", ignoreCase = true) == true }
            ?: emptyList()
    }.getOrDefault(emptyList())
}
