# luci-app-myeqosplus

My eQoS Plus is an isolated OpenWrt 25.12 LuCI package derived from luci-app-eqosplus. It combines current and historical device discovery from Wi-Fi, DHCP, wired bridge FDB, IPv4/IPv6 neighbors and optional luci-app-wifihistory data.

Policies are bound to normalized MAC addresses, so IPv4/IPv6 changes and offline periods do not lose a device policy. The LuCI device page lets users configure upload/download limits, schedules and enable state directly on each device.

The package uses the `myeqosplus` namespace for its UCI config, init script, provider, nftables table, controller, view and ACL. Existing root qdiscs are protected by default: `mq`, CAKE, SQM and other unmanaged qdiscs require an explicit `multiqueue_policy=takeover` choice. Firewall4 flow-offloading values are saved before QoS activation and restored on stop or failure.

## Build

```sh
make defconfig
make package/luci-app-myeqosplus/compile V=s
```

LuCI entry point:

```text
/cgi-bin/luci/admin/control/myeqosplus/devices
```

Device discovery commands:

```sh
/usr/sbin/myeqosplus-devices refresh
/usr/sbin/myeqosplus-devices list
/usr/sbin/myeqosplus-devices status
/usr/bin/myeqosplus status-json
```
