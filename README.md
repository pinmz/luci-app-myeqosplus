# luci-app-myeqosplus

My eQoS Plus is an isolated OpenWrt 25.12 LuCI package derived from luci-app-eqosplus. It combines current and historical device discovery from Wi-Fi, DHCP, wired bridge FDB, IPv4/IPv6 neighbors and optional luci-app-wifihistory data.

Policies are bound to normalized MAC addresses, so IPv4/IPv6 changes and offline periods do not lose a device policy. The LuCI device page lets users configure upload/download limits, weekday selection, up to eight time ranges and enable state directly on each device. Time ranges are stored as comma-separated `time_ranges` values such as `09:00-10:00,12:00-14:00`, with cross-midnight ranges supported.

The package uses the `myeqosplus` namespace for its UCI config, init script, provider, nftables table, controller, view and ACL. Existing non-MQ root qdiscs are protected by default. An existing `mq` root is preserved and managed per hardware child queue; CAKE, SQM and other unmanaged non-MQ qdiscs require an explicit `multiqueue_policy=takeover` choice. Firewall4 flow-offloading values are saved before QoS activation and restored on stop or failure.

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

## Multi-queue shaping

The default `multiqueue_mode=preserve` keeps an existing WAN `mq` root qdisc. Each hardware child queue gets its own HTB, and a stable MAC/address hash selects the queue for each device policy. If an `mq` root is present but no hardware child queue can be identified, startup fails instead of silently pretending to provide multi-queue shaping. nftables marks and `tc fw` classify traffic into the selected HTB; an egress `skbedit queue_mapping` filter pins upload packets to the same hardware queue. Downloads continue through one IFB HTB.

The upload ceiling is divided by the number of detected MQ queues, so the aggregate cannot exceed `upload_ceiling_kbit`; a device policy above its selected queue budget is safely capped at that queue budget. If the WAN has no MQ root, the service safely falls back to a single HTB root. Set `multiqueue_mode=single` to force single-queue mode. On stop, disable, or startup failure only resources owned by this package are removed and the original MQ child qdiscs are restored.
