'use strict';
'require view';
'require ui';
'require rpc';
'require uci';

var callDevices = rpc.declare({ object: 'myeqosplus', method: 'devices' });
var callStatus = rpc.declare({ object: 'myeqosplus', method: 'status' });
var callRefresh = rpc.declare({ object: 'myeqosplus', method: 'refresh' });
var callPolicy = rpc.declare({ object: 'myeqosplus', method: 'policy', params: [ 'mac', 'remove', 'name', 'enabled', 'download_kbit', 'upload_kbit', 'timestart', 'timeend', 'week' ] });

function policyFor(mac) {
	var result = null;
	uci.sections('myeqosplus', 'device').forEach(function(s) {
		if ((s.mac || '').toUpperCase() === mac.toUpperCase()) {
			result = s;
		}
	});
	return result;
}

function text(value) {
	return value || _('?');
}

function timestamp(value) {
	if (!value) return _('?');
	var d = new Date(Number(value) * 1000);
	return isNaN(d.getTime()) ? text(value) : d.toLocaleString();
}

function input(name, value, type, attrs) {
	attrs = attrs || {};
	attrs.name = name;
	attrs.type = type || 'text';
	attrs.value = value == null ? '' : value;
	attrs.class = 'cbi-input';
	return E('input', attrs);
}

return view.extend({
	load: function() {
		return Promise.all([uci.load('myeqosplus'), callDevices(), callStatus()]);
	},

	render: function(data) {
		var self = this;
		var devices = (data[1] && data[1].devices) || [];
		var status = data[2] || {};
		var root = E('div', { 'class': 'cbi-map' });
		var title = E('h2', {}, _('My eQoS Plus'));
		var description = E('p', { 'class': 'cbi-map-descr' }, _('All current and historical wired and wireless devices are listed here. Policies are bound to MAC addresses and remain available while a device is offline.'));
		var toolbar = E('div', { 'class': 'right' });
		var refresh = E('button', { 'class': 'cbi-button cbi-button-apply' }, _('Refresh devices'));
		var settings = E('a', { 'class': 'cbi-button', 'href': L.url('admin/control/myeqosplus/settings') }, _('Advanced settings'));
		var summary = E('span', { 'class': 'left', 'style': 'padding-top:6px' }, _('Total: %d, online: %d').format(devices.length, devices.filter(function(d) { return d.online; }).length));
		toolbar.appendChild(refresh);
		toolbar.appendChild(settings);
		var section = E('div', { 'class': 'cbi-section' }, [ E('div', { 'class': 'cbi-section-node' }, [ summary, toolbar ]) ]);
		root.appendChild(title);
		root.appendChild(description);
		root.appendChild(section);
		root.appendChild(E('p', { 'class': status.enabled ? 'alert-message' : 'alert-message warning' }, status.enabled ? (status.running ? _('Service is enabled and running.') : _('Service is enabled but no active qdisc is installed.')) : _('Service is disabled; no qdisc is applied.')));

		var table = E('table', { 'class': 'table cbi-section-table' });
		table.appendChild(E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Device')),
			E('th', { 'class': 'th' }, _('Addresses')),
			E('th', { 'class': 'th' }, _('Source / interface')),
			E('th', { 'class': 'th' }, _('History')),
			E('th', { 'class': 'th right' }, _('Action'))
		]));
		if (!devices.length) {
			table.appendChild(E('tr', {}, [ E('td', { 'colspan': 5 }, _('No devices discovered yet. Click Refresh devices.')) ]));
		}
		devices.forEach(function(device) {
			var p = policyFor(device.mac) || {};
			var addresses = [];
			if (device.ipv4) addresses.push(E('div', {}, 'IPv4: ' + device.ipv4));
			if (device.ipv6) addresses.push(E('div', {}, 'IPv6: ' + device.ipv6));
			if (!addresses.length) addresses.push(E('div', {}, _('No current IP address')));
			var source = [device.sources, device.interfaces].filter(Boolean).join(' / ');
			var state = device.online ? _('Online') : _('Offline / historical');
			var policyText = p.mac ? ((p.enable === '1' ? _('Policy: %s/%s kbit/s') : _('Policy disabled: %s/%s kbit/s')).format(p.download_kbit || '0', p.upload_kbit || '0')) : _('No policy');
			var edit = E('button', { 'class': 'cbi-button cbi-button-action' }, p.mac ? _('Edit policy') : _('Set limit'));
			edit.addEventListener('click', function() { self.showPolicy(device); });
			table.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, device.name || device.mac), E('br'), E('small', {}, device.mac), E('br'), E('small', {}, state) ]),
				E('td', { 'class': 'td' }, addresses),
				E('td', { 'class': 'td' }, [ E('div', {}, text(source)), E('small', {}, policyText) ]),
				E('td', { 'class': 'td' }, [ E('div', {}, _('First: %s').format(timestamp(device.first_seen))), E('div', {}, _('Last: %s').format(timestamp(device.last_seen))) ]),
				E('td', { 'class': 'td right' }, edit)
			]));
		});
		root.appendChild(E('div', { 'class': 'cbi-section' }, [ table ]));
		refresh.addEventListener('click', function() {
			refresh.disabled = true;
			callRefresh().then(function(result) {
				if (!result || !result.success) throw new Error(_('Device refresh failed'));
				location.reload();
			}).catch(function(err) { ui.addNotification(null, E('p', {}, err.message || _('Request failed')), 'error'); }).finally(function() { refresh.disabled = false; });
		});
		return root;
	},

	showPolicy: function(device) {
		var self = this;
		var p = policyFor(device.mac) || {};
		var enabled = p.enable === '1';
		var form = E('div', { 'class': 'cbi-map' }, [
			E('p', {}, [ E('strong', {}, device.name || device.mac), ' ', E('small', {}, device.mac) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Name')), E('div', { 'class': 'cbi-value-field' }, input('name', p.comment || device.name || '')) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Enable')), E('div', { 'class': 'cbi-value-field' }, input('enabled', enabled ? '1' : '0', 'checkbox', { checked: enabled })) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Download (kbit/s)')), E('div', { 'class': 'cbi-value-field' }, input('download_kbit', p.download_kbit || '0', 'number', { min: 0, max: 100000000 })) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Upload (kbit/s)')), E('div', { 'class': 'cbi-value-field' }, input('upload_kbit', p.upload_kbit || '0', 'number', { min: 0, max: 100000000 })) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Time window')), E('div', { 'class': 'cbi-value-field' }, [ input('timestart', p.timestart || '', 'time'), ' ? ', input('timeend', p.timeend || '', 'time') ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Weekdays')), E('div', { 'class': 'cbi-value-field' }, input('week', p.week || '0', 'text', { placeholder: '0 or 1,2,3' })) ]),
			E('p', { 'class': 'cbi-value-description' }, _('Set at least one non-zero rate. Weekdays use 1=Monday through 7=Sunday; 0 means every day.'))
		]);
		var save = E('button', { 'class': 'cbi-button cbi-button-save' }, _('Save policy'));
		var remove = E('button', { 'class': 'cbi-button cbi-button-reset' }, _('Delete policy'));
		var cancel = E('button', { 'class': 'cbi-button' }, _('Cancel'));
		if (!p.mac) remove.style.display = 'none';
		var buttons = E('div', { 'class': 'right' }, [ cancel, remove, save ]);
		form.appendChild(buttons);
		ui.showModal(_('Device policy'), [ form ]);
		cancel.addEventListener('click', ui.hideModal);
		remove.addEventListener('click', function() {
			remove.disabled = true;
			callPolicy(device.mac, '1', '', '', '', '', '', '', '').then(function(result) {
				if (!result || !result.success) throw new Error(result && result.error || _('Delete failed'));
				ui.hideModal(); location.reload();
			}).catch(function(err) { ui.addNotification(null, E('p', {}, err.message), 'error'); remove.disabled = false; });
		});
		save.addEventListener('click', function() {
			var values = {};
			form.querySelectorAll('input').forEach(function(el) { values[el.name] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value; });
			values.mac = device.mac;
			save.disabled = true;
			callPolicy(values.mac, '', values.name, values.enabled, values.download_kbit, values.upload_kbit, values.timestart, values.timeend, values.week).then(function(result) {
				if (!result || !result.success) throw new Error(result && result.error || _('Save failed'));
				ui.hideModal(); location.reload();
			}).catch(function(err) { ui.addNotification(null, E('p', {}, err.message), 'error'); save.disabled = false; });
		});
	}
});



