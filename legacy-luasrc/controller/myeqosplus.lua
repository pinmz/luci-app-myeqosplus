module("luci.controller.myeqosplus", package.seeall)

local fs = require "nixio.fs"
local http = require "luci.http"
local sys = require "luci.sys"
local uci = require "luci.model.uci".cursor()
local jsonc = require "luci.jsonc"
local template = require "luci.template"

local function json(data)
	http.prepare_content("application/json")
	http.write_json(data)
end

local function trim(value)
	return tostring(value or ""):match("^%s*(.-)%s*$") or ""
end

local function normalize_mac(value)
	value = trim(value):upper():gsub("-", ":")
	if not value:match("^%x%x:%x%x:%x%x:%x%x:%x%x:%x%x$") then
		return nil
	end
	return value
end

local function valid_rate(value)
	value = trim(value)
	if value == "" then return "0" end
	if not value:match("^%d+$") then return nil end
	local number = tonumber(value)
	if not number or number < 0 or number > 100000000 then return nil end
	return tostring(number)
end

local function valid_time(value)
	value = trim(value)
	if value == "" then return "" end
	local hh, mm = value:match("^(%d%d?):(%d%d)$")
	hh, mm = tonumber(hh), tonumber(mm)
	if hh and mm and hh >= 0 and hh <= 23 and mm >= 0 and mm <= 59 then
		return string.format("%02d:%02d", hh, mm)
	end
	return nil
end

local function valid_week(value)
	value = trim(value)
	if value == "" or value == "0" then return "0" end
	if not value:match("^[1-7](,[1-7])*$") then return nil end
	return value
end

local function split_tsv(line)
	local out = {}
	for field in (line .. "\t"):gmatch("(.-)\t") do
		out[#out + 1] = field
	end
	return out
end

local function read_devices()
	local result = {}
	local pipe = io.popen("/usr/sbin/myeqosplus-devices list 2>/dev/null", "r")
	if not pipe then return result end
	for line in pipe:lines() do
		local f = split_tsv(line)
		if #f >= 9 then
			result[#result + 1] = {
				mac = f[1], name = f[2], ipv4 = f[3], ipv6 = f[4],
				sources = f[5], interfaces = f[6], first_seen = tonumber(f[7]) or 0,
				last_seen = tonumber(f[8]) or 0, online = f[9] == "1"
			}
		end
	end
	pipe:close()
	return result
end

local function policy_for_mac(mac)
	local found
	uci:foreach("myeqosplus", "device", function(section)
		if normalize_mac(section.mac) == mac then
			found = {
				section = section[".name"], mac = mac,
				comment = section.comment or "",
				enable = section.enable == "1" or section.enabled == "1",
				download_kbit = section.download_kbit or "",
				upload_kbit = section.upload_kbit or "",
				download = section.download or "",
				upload = section.upload or "",
				timestart = section.timestart or "",
				timeend = section.timeend or "",
				week = section.week or "0"
			}
			return false
		end
		return true
	end)
	return found
end

local function apply_service()
	return sys.call("/etc/init.d/myeqosplus reload >/dev/null 2>&1") == 0
end

function index()
	if not fs.access("/etc/config/myeqosplus") then return end
	entry({"admin", "control"}, firstchild(), _("Control"), 44).dependent = false

	local page = entry({"admin", "control", "myeqosplus"}, call("devices_view"), _("My eQoS Plus"), 10)
	page.dependent = false
	page.acl_depends = { "luci-app-myeqosplus" }

	local settings = entry({"admin", "control", "myeqosplus", "settings"}, cbi("myeqosplus"), _("Settings"), 20)
	settings.leaf = true
	settings.acl_depends = { "luci-app-myeqosplus" }

	local devices = entry({"admin", "control", "myeqosplus", "devices"}, call("act_devices"))
	devices.leaf = true
	local policy = entry({"admin", "control", "myeqosplus", "policy"}, call("act_policy"))
	policy.leaf = true
	local refresh = entry({"admin", "control", "myeqosplus", "refresh"}, call("act_refresh"))
	refresh.leaf = true
	local status = entry({"admin", "control", "myeqosplus", "status"}, call("act_status"))
	status.leaf = true
end

function devices_view()
	template.render("myeqosplus/devices")
end

function act_devices()
	local devices = read_devices()
	for _, device in ipairs(devices) do
		device.policy = policy_for_mac(device.mac)
		device.pending = device.policy and not device.online or false
	end
	json({ success = true, devices = devices })
end

function act_refresh()
	local ok = sys.call("/usr/sbin/myeqosplus-devices refresh >/dev/null 2>&1") == 0
	json({ success = ok, error = ok and "" or _("Device discovery failed") })
end

function act_status()
	local enabled = uci:get("myeqosplus", "main", "enabled") == "1"
	local status = { success = false, enabled = enabled, running = false }
	local pipe = io.popen("/usr/bin/myeqosplus status-json 2>/dev/null", "r")
	if pipe then
		local raw = pipe:read("*a") or ""
		pipe:close()
		local parsed = jsonc.parse(raw)
		if parsed then status = parsed end
	end
	status.enabled = enabled
	local pipe2 = io.popen("/usr/sbin/myeqosplus-devices status 2>/dev/null", "r")
	if pipe2 then
		local line = pipe2:read("*l") or ""
		pipe2:close()
		status.total = tonumber(line:match("total=(%d+)")) or 0
		status.online = tonumber(line:match("online=(%d+)")) or 0
		status.offline = tonumber(line:match("offline=(%d+)")) or 0
	end
	status.success = status.success ~= false
	json(status)
end

function act_policy()
	local mac = normalize_mac(http.formvalue("mac"))
	if not mac then return json({ success = false, error = _("Invalid MAC address") }) end

	local delete = http.formvalue("delete") == "1"
	local current = policy_for_mac(mac)
	if delete then
		if current and current.section then
			uci:delete("myeqosplus", current.section)
			uci:commit("myeqosplus")
			local applied = apply_service()
			return json({ success = true, applied = applied, pending = false })
		end
		return json({ success = true, applied = true, pending = false })
	end

	local down = valid_rate(http.formvalue("download_kbit"))
	local up = valid_rate(http.formvalue("upload_kbit"))
	local start = valid_time(http.formvalue("timestart"))
	local finish = valid_time(http.formvalue("timeend"))
	local week = valid_week(http.formvalue("week"))
	if not down or not up or start == nil or finish == nil or week == nil or (down == "0" and up == "0") then
		return json({ success = false, error = _("Invalid rate, time or weekday value") })
	end
	if (start == "") ~= (finish == "") then
		return json({ success = false, error = _("Start and end time must be set together") })
	end

	local section = current and current.section
	if not section then section = uci:add("myeqosplus", "device") end
	uci:set("myeqosplus", section, "mac", mac)
	uci:set("myeqosplus", section, "device_id", mac:gsub(":", ""))
	uci:set("myeqosplus", section, "comment", trim(http.formvalue("name")))
	uci:set("myeqosplus", section, "enable", http.formvalue("enabled") == "1" and "1" or "0")
	uci:set("myeqosplus", section, "download_kbit", down)
	uci:set("myeqosplus", section, "upload_kbit", up)
	uci:set("myeqosplus", section, "timestart", start)
	uci:set("myeqosplus", section, "timeend", finish)
	uci:set("myeqosplus", section, "week", week)
	uci:commit("myeqosplus")

	local applied = apply_service()
	local device_online = false
	for _, device in ipairs(read_devices()) do
		if device.mac == mac then device_online = device.online; break end
	end
	json({ success = true, applied = applied, pending = not device_online, mac = mac })
end

function act_status_legacy()
	return act_status()
end




