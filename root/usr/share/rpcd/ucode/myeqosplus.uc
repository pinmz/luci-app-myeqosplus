'use strict';

/* rpcd-mod-ucode control plane for myeqosplus. */
import { popen } from 'fs';
import { cursor } from 'uci';

function command(commandline) {
	let p = popen(commandline, 'r');
	if (!p)
		return '';

	let output = p.read('all') || '';
	p.close();
	return output;
}

function run(commandline) {
	let p = popen(commandline, 'r');
	if (!p)
		return false;

	p.read('all');
	return p.close() == 0;
}

function normalize_mac(value) {
	value = uc(replace(trim(value || ''), /-/g, ':'));
	return match(value, /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/) ? value : null;
}

function list_devices() {
	let result = [];
	let output = command('/usr/sbin/myeqosplus-devices list 2>/dev/null');

	for (let line in split(output, '\n')) {
		let fields = split(rtrim(line, '\r'), '\t');
		if (length(fields) < 9)
			continue;

		let mac = normalize_mac(fields[0]);
		if (!mac)
			continue;

		push(result, {
			mac: mac,
			name: fields[1] || '',
			ipv4: fields[2] || '',
			ipv6: fields[3] || '',
			sources: fields[4] || '',
			interfaces: fields[5] || '',
			first_seen: +fields[6] || 0,
			last_seen: +fields[7] || 0,
			online: fields[8] == '1'
		});
	}

	return result;
}

function find_policy(mac, ctx) {
	let found = null;

	ctx.foreach('myeqosplus', 'device', function(section) {
		if (normalize_mac(section.mac) == mac)
			found = section;
	});

	return found;
}

function valid_rate(value) {
	value = trim(value || '0');
	return match(value, /^[0-9]+$/) && +value <= 100000000 ? value : null;
}

function valid_time(value) {
	value = trim(value || '');
	return !value || match(value, /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/) ? value : null;
}

function valid_week(value) {
	value = trim(value || '0');
	return value == '0' || match(value, /^[1-7](,[1-7])*$/) ? value : null;
}

function reload_service() {
	return run('/etc/init.d/myeqosplus reload >/dev/null 2>&1');
}

const methods = {
	devices: {
		call: function() {
			return { success: true, devices: list_devices() };
		}
	},

	status: {
		call: function() {
			let raw = command('/usr/bin/myeqosplus status-json 2>/dev/null');
			let parsed = null;

			try {
				parsed = json(raw);
			}
			catch (e) {
				parsed = null;
			}

			return parsed || { success: false, error: 'invalid status' };
		}
	},

	refresh: {
		call: function() {
			return {
				success: run('/usr/sbin/myeqosplus-devices refresh >/dev/null 2>&1')
			};
		}
	},

	reload: {
		call: function() {
			return { success: reload_service() };
		}
	},

	policy: {
		args: {
			mac: '',
			remove: '',
			name: '',
			enabled: '',
			download_kbit: '',
			upload_kbit: '',
			timestart: '',
			timeend: '',
			week: ''
		},

		call: function(request) {
			let args = request.args || {};
			let mac = normalize_mac(args.mac);
			if (!mac)
				return { success: false, error: 'invalid mac' };

			let ctx = cursor();
			let old = find_policy(mac, ctx);

			if (args.remove == '1') {
				if (old)
					ctx.delete('myeqosplus', old['.name']);

				if (!ctx.commit('myeqosplus'))
					return { success: false, error: 'unable to commit policy' };

				let applied = reload_service();
				return {
					success: applied,
					applied: applied,
					saved: true,
					error: applied ? '' : 'service reload failed'
				};
			}

			let down = valid_rate(args.download_kbit);
			let up = valid_rate(args.upload_kbit);
			let start = valid_time(args.timestart);
			let end = valid_time(args.timeend);
			let week = valid_week(args.week);

			if (down == null || up == null || (+down == 0 && +up == 0) ||
			    start == null || end == null || week == null || (!!start != !!end))
				return { success: false, error: 'invalid policy value' };

			let section = old ? old['.name'] : ctx.add('myeqosplus', 'device');
			if (!section)
				return { success: false, error: 'unable to create policy' };

			ctx.set('myeqosplus', section, 'mac', mac);
			ctx.set('myeqosplus', section, 'device_id', replace(mac, /:/g, ''));
			ctx.set('myeqosplus', section, 'comment', trim(args.name || ''));
			ctx.set('myeqosplus', section, 'enable', args.enabled == '1' ? '1' : '0');
			ctx.set('myeqosplus', section, 'download_kbit', down);
			ctx.set('myeqosplus', section, 'upload_kbit', up);
			ctx.set('myeqosplus', section, 'timestart', start);
			ctx.set('myeqosplus', section, 'timeend', end);
			ctx.set('myeqosplus', section, 'week', week);

			if (!ctx.commit('myeqosplus'))
				return { success: false, error: 'unable to commit policy' };

			let applied = reload_service();
			return {
				success: applied,
				applied: applied,
				saved: true,
				error: applied ? '' : 'service reload failed'
			};
		}
	}
};

/* The top-level key is the ubus object name registered by rpcd. */
return { myeqosplus: methods };
