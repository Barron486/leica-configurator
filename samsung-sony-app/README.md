# Samsung Watch → Sony Headphones Control App

A two-module Android project that lets a **Samsung Galaxy Watch** (Wear OS 3+)
control **Sony MDR/WH/WF headphones** wirelessly.

## Architecture

```
┌─────────────────────┐      Wearable Data Layer      ┌─────────────────────┐
│   Samsung Watch     │ ──────────────────────────────▶│   Android Phone     │
│   (wear module)     │ ◀──────────────────────────── │   (phone module)    │
│                     │     DataItem (state sync)      │                     │
│  WearMainActivity   │                                │  WatchListenerSvc   │
│  WatchCommandSender │                                │  StateSyncManager   │
│  StateReceiver      │                                │  SonyBleManager     │
└─────────────────────┘                                └──────────┬──────────┘
                                                                   │ Classic BT
                                                                   │ (RFCOMM/SPP)
                                                            ┌──────▼──────────┐
                                                            │  Sony Headphones │
                                                            │  (WH-1000XM5 etc)│
                                                            └──────────────────┘
```

## Modules

| Module   | Description |
|----------|-------------|
| `shared` | Sony protocol definitions, command serialisation, shared state model |
| `phone`  | Android companion app — BT connection to headphones + Wearable relay |
| `wear`   | Wear OS app — UI on the watch, sends commands via Wearable Message API |

## Key Files

```
shared/
  SonyCommand.kt        – frame builder, parser, ANC/EQ/volume payloads
  SonyState.kt          – shared data classes + watch command serialiser

phone/
  SonyBleManager.kt     – RFCOMM socket to Sony headphones
  WatchListenerService.kt – receives WatchCommands, calls BleManager
  StateSyncManager.kt   – pushes headphone state to watch via DataItem

wear/
  WatchCommandSender.kt – sends commands to phone via Message API
  StateReceiver.kt      – listens to DataItem updates from phone
  WearMainActivity.kt   – Compose UI: ANC, volume, EQ controls
```

## Supported Controls

| Feature               | Status |
|-----------------------|--------|
| ANC / Ambient / Off   | ✅ |
| Ambient level (0–20)  | ✅ |
| Volume (0–30)         | ✅ |
| EQ preset selection   | ✅ |
| Battery level display | ✅ |
| Device name display   | ✅ |

## Supported Headphones

Any Sony headphone that supports the MDR proprietary RFCOMM protocol, including:
- WH-1000XM3 / XM4 / XM5
- WF-1000XM3 / XM4 / XM5
- WH-CH710N / CH720N

## Building

1. Open the `samsung-sony-app/` folder in Android Studio Hedgehog or later.
2. Pair your Samsung Galaxy Watch 4/5/6 with your phone (requires Wear OS 3+).
3. Build and install **both** `phone` and `wear` modules to the respective devices.
4. Open the phone app, select your Sony headphones from the paired-device list.
5. Control from your wrist.

## Sony Protocol Notes

Sony does not publish an official SDK. This implementation uses the reverse-
engineered protocol documented by the open-source community:
- https://github.com/Plutoberth/SonyHeadphonesClient (MIT)
- https://github.com/Freeyourgadget/Gadgetbridge (AGPL)
