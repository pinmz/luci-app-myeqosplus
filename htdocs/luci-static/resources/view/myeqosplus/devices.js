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

function uniqueValues(value) {
	var seen = {};
	return String(value || '').split(',').map(function(item) { return item.trim(); }).filter(function(item) {
		if (!item || seen[item]) return false;
		seen[item] = true;
		return true;
	});
}

function sourceText(value) {
	var labels = {
		dhcp: _('DHCP 租约'),
		neigh: _('IP 邻居表'),
		bridge: _('网桥 FDB'),
		wifi: _('Wi-Fi 客户端'),
		iw: _('Wi-Fi 客户端'),
		iwinfo: _('Wi-Fi 客户端'),
		wifihistory: _('Wi-Fi 历史记录')
	};
	return uniqueValues(value).map(function(item) { return labels[item.toLowerCase()] || item; }).join('、');
}

function interfaceText(value) {
	return uniqueValues(value).join('、');
}


function timestamp(value) {
	if (!value) return _('?');
	var d = new Date(Number(value) * 1000);
	return isNaN(d.getTime()) ? text(value) : d.toLocaleString();
}

function errorMessage(err, fallback) {
	var message = err && err.message;
	return message && /[\u3400-\u9fff]/.test(message) ? message : fallback;
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
		var devices = callDevices().catch(function(err) {
			console.error('myeqosplus 设备 RPC 调用失败：', err);
			return { devices: [], _rpc_error: true };
		});
		var status = callStatus().catch(function(err) {
			console.error('myeqosplus 状态 RPC 调用失败：', err);
			return { _rpc_error: true };
		});
		return Promise.all([uci.load('myeqosplus'), devices, status]);
	},

	render: function(data) {
		var self = this;
		var devices = (data[1] && data[1].devices) || [];
		var status = data[2] || {};
		var root = E('div', { 'class': 'cbi-map' });
		var title = E('h2', {}, _('设备限速增强版'));
		var description = E('p', { 'class': 'cbi-map-descr' }, _('此处列出当前和历史有线、无线设备。限速策略按 MAC 地址绑定，设备离线后仍会保留。'));
		var toolbar = E('div', { 'class': 'right' });
		var refresh = E('button', { 'class': 'cbi-button cbi-button-apply' }, _('刷新设备'));
		var settings = E('a', { 'class': 'cbi-button', 'href': L.url('admin/control/myeqosplus/settings') }, _('高级设置'));
		var summary = E('span', { 'class': 'left', 'style': 'padding-top:6px' }, _('设备总数：%d，在线：%d').format(devices.length, devices.filter(function(d) { return d.online; }).length));
		toolbar.appendChild(refresh);
		toolbar.appendChild(settings);
		var section = E('div', { 'class': 'cbi-section' }, [ E('div', { 'class': 'cbi-section-node' }, [ summary, toolbar ]) ]);
		root.appendChild(title);
		root.appendChild(description);
		root.appendChild(section);
		if ((data[1] && data[1]._rpc_error) || status._rpc_error)
			root.appendChild(E('p', { 'class': 'alert-message warning' }, _('myeqosplus RPC 服务不可用，请重启 rpcd 并检查 ucode 插件。')));
		else
			root.appendChild(E('p', { 'class': status.enabled ? 'alert-message' : 'alert-message warning' }, status.enabled ? (status.running ? _('服务已启用并正在运行。') : _('服务已启用，但当前未安装活动的 qdisc。')) : _('服务已禁用，未应用任何 qdisc。')));

		var table = E('table', { 'class': 'table cbi-section-table' });
		table.appendChild(E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('设备')),
			E('th', { 'class': 'th' }, _('地址')),
			E('th', { 'class': 'th' }, _('来源 / 接口')),
			E('th', { 'class': 'th' }, _('历史记录')),
			E('th', { 'class': 'th right' }, _('操作'))
		]));
		if (!devices.length) {
			table.appendChild(E('tr', {}, [ E('td', { 'colspan': 5 }, _('尚未发现设备，请点击“刷新设备”。')) ]));
		}
		devices.forEach(function(device) {
			var p = policyFor(device.mac) || {};
			var addresses = [];
			if (device.ipv4) addresses.push(E('div', {}, 'IPv4: ' + device.ipv4));
			if (device.ipv6) addresses.push(E('div', {}, 'IPv6: ' + device.ipv6));
			if (!addresses.length) addresses.push(E('div', {}, _('当前无 IP 地址')));
			var source = [sourceText(device.sources), interfaceText(device.interfaces)].filter(Boolean).join(' / ');
			var state = device.online ? _('在线') : _('离线 / 历史设备');
			var policyText = p.mac ? ((p.enable === '1' ? _('限速策略：下载 %s / 上传 %s kbit/s') : _('限速策略已禁用：下载 %s / 上传 %s kbit/s')).format(p.download_kbit || '0', p.upload_kbit || '0')) : _('未设置限速');
			var edit = E('button', { 'class': 'cbi-button cbi-button-action' }, p.mac ? _('编辑限速') : _('设置限速'));
			edit.addEventListener('click', function() { self.showPolicy(device); });
			table.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, device.name || device.mac), E('br'), E('small', {}, device.mac), E('br'), E('small', {}, state) ]),
				E('td', { 'class': 'td' }, addresses),
				E('td', { 'class': 'td' }, [ E('div', {}, text(source)), E('small', {}, policyText) ]),
				E('td', { 'class': 'td' }, [ E('div', {}, _('首次发现：%s').format(timestamp(device.first_seen))), E('div', {}, _('最后发现：%s').format(timestamp(device.last_seen))) ]),
				E('td', { 'class': 'td right' }, edit)
			]));
		});
		root.appendChild(E('div', { 'class': 'cbi-section' }, [ table ]));
		refresh.addEventListener('click', function() {
			refresh.disabled = true;
			callRefresh().then(function(result) {
				if (!result || !result.success) throw new Error(_('设备刷新失败'));
				location.reload();
			}).catch(function(err) {
				console.error('设备刷新失败：', err);
				ui.addNotification(null, E('p', {}, errorMessage(err, _('设备刷新失败，请检查 rpcd 服务。'))), 'error');
			}).finally(function() { refresh.disabled = false; });
		});
		return root;
	},

	showPolicy: function(device) {
		var self = this;
		var p = policyFor(device.mac) || {};
		var enabled = p.enable === '1';
		var form = E('div', { 'class': 'cbi-map' }, [
			E('p', {}, [ E('strong', {}, device.name || device.mac), ' ', E('small', {}, device.mac) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('设备名称')), E('div', { 'class': 'cbi-value-field' }, input('name', p.comment || device.name || '')) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('启用')), E('div', { 'class': 'cbi-value-field' }, input('enabled', enabled ? '1' : '0', 'checkbox', { checked: enabled })) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('下载限速（kbit/s）')), E('div', { 'class': 'cbi-value-field' }, input('download_kbit', p.download_kbit || '0', 'number', { min: 0, max: 100000000 })) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('上传限速（kbit/s）')), E('div', { 'class': 'cbi-value-field' }, input('upload_kbit', p.upload_kbit || '0', 'number', { min: 0, max: 100000000 })) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('生效时段')), E('div', { 'class': 'cbi-value-field' }, [ input('timestart', p.timestart || '', 'time'), ' 至 ', input('timeend', p.timeend || '', 'time') ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('生效星期')), E('div', { 'class': 'cbi-value-field' }, input('week', p.week || '0', 'text', { placeholder: '0 或 1,2,3' })) ]),
			E('p', { 'class': 'cbi-value-description' }, _('上传或下载至少设置一个非零限速值。星期使用 1=星期一至 7=星期日，0 表示每天。'))
		]);
		var save = E('button', { 'class': 'cbi-button cbi-button-save' }, _('保存限速'));
		var remove = E('button', { 'class': 'cbi-button cbi-button-reset' }, _('删除限速'));
		var cancel = E('button', { 'class': 'cbi-button' }, _('取消'));
		if (!p.mac) remove.style.display = 'none';
		var buttons = E('div', { 'class': 'right' }, [ cancel, remove, save ]);
		form.appendChild(buttons);
		ui.showModal(_('设备限速策略'), [ form ]);
		cancel.addEventListener('click', ui.hideModal);
		remove.addEventListener('click', function() {
			remove.disabled = true;
			callPolicy(device.mac, '1', '', '', '', '', '', '', '').then(function(result) {
				if (!result || !result.success) throw new Error(result && result.error || _('删除限速策略失败'));
				ui.hideModal(); location.reload();
			}).catch(function(err) {
				console.error('删除限速策略失败：', err);
				ui.addNotification(null, E('p', {}, errorMessage(err, _('删除限速策略失败，请检查 rpcd 服务。'))), 'error');
				remove.disabled = false;
			});
		});
		save.addEventListener('click', function() {
			var values = {};
			form.querySelectorAll('input').forEach(function(el) { values[el.name] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value; });
			values.mac = device.mac;
			save.disabled = true;
			callPolicy(values.mac, '', values.name, values.enabled, values.download_kbit, values.upload_kbit, values.timestart, values.timeend, values.week).then(function(result) {
				if (!result || !result.success) throw new Error(result && result.error || _('保存限速策略失败'));
				ui.hideModal(); location.reload();
			}).catch(function(err) {
				console.error('保存限速策略失败：', err);
				ui.addNotification(null, E('p', {}, errorMessage(err, _('保存限速策略失败，请检查 rpcd 服务。'))), 'error');
				save.disabled = false;
			});
		});
	}
});



