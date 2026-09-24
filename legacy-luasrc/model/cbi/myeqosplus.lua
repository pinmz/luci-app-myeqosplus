local Map = Map
local NamedSection = NamedSection
local TypedSection = TypedSection
local Flag = Flag
local ListValue = ListValue
local Value = Value
local DummyValue = DummyValue

local m = Map("myeqosplus", translate("My eQoS Plus settings"))
m.description = translate("QoS is bound to device MAC addresses. The device page combines Wi-Fi history, DHCP, IPv4/IPv6 neighbors and wired bridge discovery.")

local main = m:section(NamedSection, "main", "myeqosplus")
main.addremove = false
main.anonymous = true

local enabled = main:option(Flag, "enabled", translate("Enable service"))
enabled.rmempty = false
enabled.default = "0"

e = main:option(ListValue, "ifname", translate("WAN shaping interface"), translate("Use auto to resolve the active WAN L3 device. An explicit interface is recommended on multi-WAN systems."))
e:value("1", translate("Auto (WAN)"))
e:value("auto", translate("Auto (WAN)"))
for _, iface in ipairs(require("luci.sys").net:devices()) do
	if iface ~= "lo" then e:value(iface, iface) end
end
e.default = "1"

e = main:option(ListValue, "multiqueue_policy", translate("Existing root qdisc"), translate("Refuse is safe and preserves mq/CAKE/SQM. Takeover may replace the existing root qdisc."))
e:value("refuse", translate("Refuse takeover (recommended)"))
e:value("takeover", translate("Allow takeover"))
e.default = "refuse"

e = main:option(Flag, "preserve_existing_qdisc", translate("Protect unmanaged qdisc"))
e.default = "1"
e.rmempty = false

e = main:option(Flag, "manage_flow_offloading", translate("Temporarily disable flow offloading"), translate("The original firewall flow-offloading values are restored when the service stops."))
e.default = "1"
e.rmempty = false

e = main:option(Value, "history_retention_days", translate("History retention (days)"))
e.datatype = "uinteger"
e.default = "90"

e = main:option(Value, "refresh_interval", translate("Refresh interval (seconds)"))
e.datatype = "uinteger"
e.default = "30"

local devices = m:section(TypedSection, "device", translate("Stored policies"))
devices.anonymous = true
devices.addremove = true
devices.sortable = true
devices.description = translate("Use the device browser for discovery. This section is retained for advanced and compatibility editing.")

e = devices:option(Value, "comment", translate("Device name"))
e = devices:option(Value, "mac", translate("MAC address"))
e.datatype = "macaddr"
e = devices:option(Flag, "enable", translate("Enabled"))
e.rmempty = false
e = devices:option(Value, "download_kbit", translate("Download (kbit/s)"))
e.datatype = "uinteger"
e.default = "0"
e = devices:option(Value, "upload_kbit", translate("Upload (kbit/s)"))
e.datatype = "uinteger"
e.default = "0"
e = devices:option(Value, "timestart", translate("Start"))
e.placeholder = "00:00"
e = devices:option(Value, "timeend", translate("End"))
e.placeholder = "00:00"
e = devices:option(Value, "week", translate("Week (1-7, 0=all)"))
e.default = "0"

return m
