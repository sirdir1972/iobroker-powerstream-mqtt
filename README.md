# ioBroker EcoFlow MQTT Integration

This script integrates **EcoFlow PowerStream** and **Delta 2 Max** devices into ioBroker using **MQTT**. It supports real-time monitoring, dynamic feed-in regulation based on power demand, and priority control — perfect for solar surplus usage.

## Features

- Automatic connection to the **EcoFlow MQTT API** with certificate handling
- Supports:
  - PowerStream inverters
  - Delta 2 Max storage units
- Configurable time windows for regulation (e.g., disable at night)
- Surplus logic: dynamically adjusts feed-in based on household demand
- MQTT subscriptions for live device data
- Writeable ioBroker states for control via UI or other scripts
- Periodic system health monitoring and auto-reconnect

## Requirements

- ioBroker with JavaScript adapter
- Your **EcoFlow Access Key** and **Secret Key**
- MQTT access enabled via EcoFlow Developer Portal: https://api-e.ecoflow.com/
- Optional: external power meter (e.g., Shelly) providing household demand data

## Installation

1. Paste the script into the JavaScript adapter in ioBroker.
2. Fill in your device serial numbers, API credentials, and configuration values in the `ConfigData` block.
3. Make sure your EcoFlow account is authorized for MQTT access.

## Configuration

```js
var ConfigData = {
  PS: [ { serial: '' }, ... ], // PowerStream devices
  D2M: [ { serial: '' } ],     // Delta 2 Max devices
  statesPrefix: '0_userdata.0.ecoflow_public_api',
  runEvery: 4, // Script runs every X seconds
  demand: '0_userdata.0.sumpower.actualDemand',
  LowerLimitPerecents: 10,
  LowerLimitMaxWatts: 1000,
  DoSleepFrom: 24, // Sleep time starts (set "" to disable sleep)
  DoSleepTo: 8     // Sleep time ends
};
```

**Important:** Replace the credentials:
```js
const accessKey = 'YOUR_ACCESS_KEY';
const secretKey = 'YOUR_SECRET_KEY';
const MQTT_Clientid = 134522; // Any random number
```

## Manual Control via ioBroker States

You can control your devices through ioBroker by writing to these states:

- `setAC` → desired output power (in watts)
- `setSupplyPriority` → set priority between grid and PV
- `regulate` → enable/disable dynamic surplus regulation
- `Debug` → enable detailed logging

Monitored values include `pv1InputWatts`, `batSoc`, `permanentWatts`, and more.

## Dynamic Surplus Regulation

The script uses real-time power demand data to intelligently distribute feed-in power among PowerStream devices:

- Devices with low battery levels are capped
- Remaining demand is distributed proportionally to battery charge (SoC)
- Underperforming devices are compensated by others if possible

## System Health Monitoring

Every 5 minutes, the script checks:

- MQTT connection status
- Certificate validity
- Active device count (based on recent MQTT messages)

If no active devices are detected or MQTT fails, the script triggers a reconnect.

## Security

**Do not share your credentials** in public repositories. Use `.gitignore` to avoid publishing sensitive data.

## License

This script is free to use and adapt for personal use. No warranty or liability provided.%   
