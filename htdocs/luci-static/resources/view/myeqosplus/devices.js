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
	attrs.id = attrs.id || 'myeqosplus-policy-' + name;
	attrs.name = name;
	attrs.type = type || 'text';
	attrs.value = value == null ? '' : value;
	attrs.class = 'cbi-input';
	return E('input', attrs);
}

function weekSelection(value) {
	value = String(value || '0').trim();
	if (value === '0') return [ '0' ];

	var selected = [];
	value.split(',').forEach(function(day) {
		day = day.trim();
		if (/^[1-7]$/.test(day) && selected.indexOf(day) < 0)
			selected.push(day);
	});
	return selected.length ? selected : [ '0' ];
}

function validatePolicy(values) {
	var ratePattern = /^[0-9]+$/;
	var timePattern = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
	var weekPattern = /^[1-7](,[1-7])*$/;
	var down = String(values.download_kbit || '').trim() || '0';
	var up = String(values.upload_kbit || '').trim() || '0';
	var start = String(values.timestart || '').trim();
	var end = String(values.timeend || '').trim();
	var week = String(values.week || '').trim() || '0';

	if (!ratePattern.test(down) || Number(down) > 100000000)
		return { field: 'download_kbit', message: _('下载限速必须是 0 至 100000000 之间的整数。') };
	if (!ratePattern.test(up) || Number(up) > 100000000)
		return { field: 'upload_kbit', message: _('上传限速必须是 0 至 100000000 之间的整数。') };
	if (Number(down) === 0 && Number(up) === 0)
		return { field: 'download_kbit', fields: [ 'download_kbit', 'upload_kbit' ], message: _('下载和上传限速不能同时为 0，请至少设置一个非零值。') };
	if ((start && !timePattern.test(start)) || (end && !timePattern.test(end)))
		return { field: start && !timePattern.test(start) ? 'timestart' : 'timeend', message: _('生效时间格式无效，请使用 HH:MM 格式。') };
	if (!!start !== !!end)
		return { field: start ? 'timeend' : 'timestart', fields: [ 'timestart', 'timeend' ], message: _('开始时间和结束时间必须同时填写，或同时留空。') };
	if (week !== '0' && !weekPattern.test(week))
		return { field: 'week', message: _('生效星期格式无效：每天填写 0；指定日期请使用 1 至 7，并以英文逗号分隔。') };

	values.download_kbit = down;
	values.upload_kbit = up;
	values.timestart = start;
	values.timeend = end;
	values.week = week;
	return null;
}

function showPolicyToast(title, message, level) {
	document.querySelectorAll('.myeqosplus-policy-toast').forEach(function(node) {
		if (node.parentNode) node.parentNode.removeChild(node);
	});

	var content = E('p', {}, message);
	var toast;
	if (typeof ui.addTimeLimitedNotification === 'function')
		toast = ui.addTimeLimitedNotification(title, content, 5000, level || 'warning');
	else {
		toast = ui.addNotification(title, content, level || 'warning');
		window.setTimeout(function() {
			if (toast.parentNode) toast.parentNode.removeChild(toast);
		}, 5000);
	}
	toast.classList.add('myeqosplus-policy-toast');
}

function policyField(form, name) {
	return form.querySelector('[name="' + name + '"], [data-policy-field="' + name + '"]');
}

function markPolicyInvalid(form, validation) {
	form.querySelectorAll('.myeqosplus-policy-invalid').forEach(function(field) {
		field.classList.remove('myeqosplus-policy-invalid');
		field.removeAttribute('aria-invalid');
	});

	var names = validation.fields || [ validation.field ];
	names.forEach(function(name) {
		var field = policyField(form, name);
		if (!field) return;
		field.classList.add('myeqosplus-policy-invalid');
		field.setAttribute('aria-invalid', 'true');
	});

	var focusField = policyField(form, validation.field);
	if (focusField) focusField.focus();
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
		var hasName = device.name && device.name.toUpperCase() !== device.mac.toUpperCase();
		var displayName = hasName ? device.name : _('未命名设备');
		var configuredName = p.comment || (hasName ? device.name : '');
		var selectedWeek = weekSelection(p.week);
		var weekDropdown = new ui.Dropdown(selectedWeek, {
			'0': _('每天'),
			'1': _('星期一'),
			'2': _('星期二'),
			'3': _('星期三'),
			'4': _('星期四'),
			'5': _('星期五'),
			'6': _('星期六'),
			'7': _('星期日')
		}, {
			id: 'myeqosplus-policy-week',
			multiple: true,
			optional: false,
			sort: [ '0', '1', '2', '3', '4', '5', '6', '7' ],
			display_items: 4,
			dropdown_items: 8
		});
		var weekNode = weekDropdown.render();
		weekNode.setAttribute('data-policy-field', 'week');
		weekNode.setAttribute('aria-label', _('生效星期'));
		var previousWeek = selectedWeek.slice();
		var normalizingWeek = false;
		weekNode.addEventListener('cbi-dropdown-change', function() {
			if (normalizingWeek) return;
			var selected = weekDropdown.getValue();
			var hadEveryDay = previousWeek.indexOf('0') >= 0;
			var hasEveryDay = selected.indexOf('0') >= 0;

			if (hasEveryDay && selected.length > 1) {
				normalizingWeek = true;
				weekDropdown.setValue(hadEveryDay ? selected.filter(function(day) { return day !== '0'; }) : [ '0' ]);
				normalizingWeek = false;
			}
			previousWeek = weekDropdown.getValue().slice();
		});
		var policyStyle = [
			'.myeqosplus-policy-form{width:min(680px,calc(100vw - 48px));max-width:100%;box-sizing:border-box}',
			'.myeqosplus-policy-device{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;margin-bottom:18px;border:1px solid #dfe5ee;border-radius:6px;background:#f7f9fc}',
			'.myeqosplus-policy-device-name{font-size:1.08rem;font-weight:600;overflow-wrap:anywhere}',
			'.myeqosplus-policy-mac{padding:3px 8px;border-radius:4px;background:#e9edf5;white-space:nowrap}',
			'.myeqosplus-policy-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 20px}',
			'.myeqosplus-policy-field{display:flex;flex-direction:column;gap:7px;min-width:0}',
			'.myeqosplus-policy-field-full{grid-column:1/-1}',
			'.myeqosplus-policy-label{font-weight:600;color:var(--text-color-high,#334)}',
			'.myeqosplus-policy-field input:not([type=checkbox]),.myeqosplus-policy-field .cbi-dropdown{width:100%;max-width:none;box-sizing:border-box}',
			'.myeqosplus-policy-field input.myeqosplus-policy-invalid,.myeqosplus-policy-field .cbi-dropdown.myeqosplus-policy-invalid{border-color:#d94c4c!important;box-shadow:0 0 0 1px rgba(217,76,76,.18)!important}',
			'.myeqosplus-policy-toast{position:fixed!important;top:18px!important;left:50%!important;right:auto!important;z-index:20000!important;width:min(560px,calc(100vw - 32px))!important;max-width:none!important;transform:translateX(-50%);box-sizing:border-box;box-shadow:0 8px 28px rgba(0,0,0,.28)}',
			'.myeqosplus-policy-toggle{display:flex;align-items:center;gap:9px;min-height:36px}',
			'.myeqosplus-policy-toggle input{margin:0}',
			'.myeqosplus-policy-time{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:10px}',
			'.myeqosplus-policy-help{margin:16px 0 0;padding:10px 12px;border-left:3px solid #5e72e4;background:#f7f8ff;color:#687083;line-height:1.6}',
			'.myeqosplus-policy-inline-help{font-size:.86rem;color:#7a8294;line-height:1.5}',
			'.myeqosplus-policy-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid #e6e9ef}',
			'.myeqosplus-policy-actions .myeqosplus-policy-delete{margin-right:auto}',
			'@media(max-width:600px){.myeqosplus-policy-form{width:calc(100vw - 32px)}.myeqosplus-policy-grid{grid-template-columns:1fr}.myeqosplus-policy-field-full{grid-column:auto}.myeqosplus-policy-device{align-items:flex-start;flex-direction:column}.myeqosplus-policy-time{grid-template-columns:1fr}.myeqosplus-policy-time-separator{text-align:center}.myeqosplus-policy-actions{flex-wrap:wrap}.myeqosplus-policy-actions .myeqosplus-policy-delete{width:100%;margin:0 0 4px}}'
		].join('');
		var form = E('div', { 'class': 'cbi-map myeqosplus-policy-form' }, [
			E('style', {}, policyStyle),
			E('div', { 'class': 'myeqosplus-policy-device' }, [
				E('div', { 'class': 'myeqosplus-policy-device-name' }, displayName),
				E('code', { 'class': 'myeqosplus-policy-mac' }, device.mac)
			]),
			E('div', { 'class': 'myeqosplus-policy-grid' }, [
				E('div', { 'class': 'myeqosplus-policy-field myeqosplus-policy-field-full' }, [
					E('label', { 'class': 'myeqosplus-policy-label', 'for': 'myeqosplus-policy-name' }, _('设备名称')),
					input('name', configuredName, 'text', { placeholder: _('例如：客厅电视') })
				]),
				E('div', { 'class': 'myeqosplus-policy-field myeqosplus-policy-field-full' }, [
					E('span', { 'class': 'myeqosplus-policy-label' }, _('策略状态')),
					E('label', { 'class': 'myeqosplus-policy-toggle', 'for': 'myeqosplus-policy-enabled' }, [
						input('enabled', enabled ? '1' : '0', 'checkbox', { checked: enabled }),
						E('span', {}, _('启用此设备的限速策略'))
					])
				]),
				E('div', { 'class': 'myeqosplus-policy-field' }, [
					E('label', { 'class': 'myeqosplus-policy-label', 'for': 'myeqosplus-policy-download_kbit' }, _('下载限速（kbit/s）')),
					input('download_kbit', p.download_kbit || '0', 'number', { min: 0, max: 100000000, step: 1, placeholder: '0' })
				]),
				E('div', { 'class': 'myeqosplus-policy-field' }, [
					E('label', { 'class': 'myeqosplus-policy-label', 'for': 'myeqosplus-policy-upload_kbit' }, _('上传限速（kbit/s）')),
					input('upload_kbit', p.upload_kbit || '0', 'number', { min: 0, max: 100000000, step: 1, placeholder: '0' })
				]),
				E('div', { 'class': 'myeqosplus-policy-field myeqosplus-policy-field-full' }, [
					E('span', { 'class': 'myeqosplus-policy-label' }, _('生效时段')),
					E('div', { 'class': 'myeqosplus-policy-time' }, [
						input('timestart', p.timestart || '', 'time', { 'aria-label': _('开始时间') }),
						E('span', { 'class': 'myeqosplus-policy-time-separator' }, _('至')),
						input('timeend', p.timeend || '', 'time', { 'aria-label': _('结束时间') })
					])
				]),
				E('div', { 'class': 'myeqosplus-policy-field myeqosplus-policy-field-full' }, [
					E('label', { 'class': 'myeqosplus-policy-label', 'for': 'myeqosplus-policy-week' }, _('生效星期')),
					weekNode,
					E('div', { 'class': 'myeqosplus-policy-inline-help' }, _('支持多选；选择“每天”会自动取消其他星期，选择具体星期会自动取消“每天”。'))
				])
			]),
			E('p', { 'class': 'myeqosplus-policy-help' }, _('下载和上传至少设置一个非零限速值；生效时段留空表示全天生效。'))
		]);
		var save = E('button', { 'class': 'cbi-button cbi-button-save' }, _('保存限速'));
		var remove = E('button', { 'class': 'cbi-button cbi-button-reset myeqosplus-policy-delete' }, _('删除限速'));
		var cancel = E('button', { 'class': 'cbi-button' }, _('取消'));
		if (!p.mac) remove.style.display = 'none';
		var buttons = E('div', { 'class': 'myeqosplus-policy-actions' }, [ remove, cancel, save ]);
		form.appendChild(buttons);
		ui.showModal(_('设置设备限速'), [ form ]);
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
			form.querySelectorAll('.myeqosplus-policy-invalid').forEach(function(el) {
				el.classList.remove('myeqosplus-policy-invalid');
				el.removeAttribute('aria-invalid');
			});
			form.querySelectorAll('input[name]').forEach(function(el) {
				values[el.name] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
			});
			values.mac = device.mac;
			values.week = weekDropdown.getValue().join(',');

			var validation = validatePolicy(values);
			if (validation) {
				markPolicyInvalid(form, validation);
				showPolicyToast(_('参数无效'), validation.message, 'warning');
				return;
			}

			save.disabled = true;
			callPolicy(values.mac, '', values.name, values.enabled, values.download_kbit, values.upload_kbit, values.timestart, values.timeend, values.week).then(function(result) {
				if (!result || !result.success) throw new Error(result && result.error || _('保存限速策略失败'));
				ui.hideModal(); location.reload();
			}).catch(function(err) {
				console.error('保存限速策略失败：', err);
				showPolicyToast(_('保存失败'), errorMessage(err, _('保存限速策略失败，请检查 rpcd 服务。')), 'error');
				save.disabled = false;
			});
		});
	}
});



