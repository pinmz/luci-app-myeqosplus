'use strict';
'require view';
'require ui';
'require rpc';
'require uci';

var callDevices = rpc.declare({ object: 'myeqosplus', method: 'devices' });
var callStatus = rpc.declare({ object: 'myeqosplus', method: 'status' });
var callRefresh = rpc.declare({ object: 'myeqosplus', method: 'refresh' });
var callPolicy = rpc.declare({ object: 'myeqosplus', method: 'policy', params: [ 'mac', 'remove', 'name', 'enabled', 'download_kbit', 'upload_kbit', 'timestart', 'timeend', 'time_ranges', 'week' ] });

function policyFor(mac) {
	var result = null;
	uci.sections('myeqosplus', 'device').forEach(function(s) {
		if ((s.mac || '').toUpperCase() === mac.toUpperCase()) {
			result = s;
		}
	});
	return result;
}

function deviceDisplayName(device, policy) {
	var configured = String(policy && policy.comment || '').trim();
	if (configured)
		return configured;

	var discovered = String(device && device.name || '').trim();
	var mac = String(device && device.mac || '').trim();
	if (discovered && (!mac || discovered.toUpperCase() !== mac.toUpperCase()))
		return discovered;

	return '';
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

var MAX_TIME_RANGES = 8;

function parseTimeRanges(value, legacyStart, legacyEnd) {
	var source = String(value || '').trim();
	var result = [];
	var pattern = /^([01]?[0-9]|2[0-3]):([0-5][0-9])-([01]?[0-9]|2[0-3]):([0-5][0-9])$/;

	if (!source && legacyStart && legacyEnd && legacyStart !== legacyEnd)
		source = legacyStart + '-' + legacyEnd;

	source.split(',').forEach(function(item) {
		var match = item.trim().match(pattern);
		if (match)
			result.push({ start: ('0' + match[1]).slice(-2) + ':' + match[2], end: ('0' + match[3]).slice(-2) + ':' + match[4] });
	});

	return result.length ? result.slice(0, MAX_TIME_RANGES) : [ { start: '', end: '' } ];
}

function reindexTimeRangeRows(container) {
	container.querySelectorAll('.myeqosplus-policy-time-row').forEach(function(row, index) {
		var position = index + 1;
		var start = row.querySelector('[data-time-range-role="start"]');
		var end = row.querySelector('[data-time-range-role="end"]');
		start.id = 'myeqosplus-policy-time-start-' + index;
		end.id = 'myeqosplus-policy-time-end-' + index;
		start.setAttribute('data-policy-field', 'time_range_start_' + index);
		end.setAttribute('data-policy-field', 'time_range_end_' + index);
		start.setAttribute('aria-label', _('第 %d 个时段开始时间').format(position));
		end.setAttribute('aria-label', _('第 %d 个时段结束时间').format(position));
	});
}

function appendTimeRangeRow(container, value) {
	var start = E('input', {
		'class': 'cbi-input',
		type: 'time',
		value: value && value.start || '',
		'data-time-range-role': 'start'
	});
	var end = E('input', {
		'class': 'cbi-input',
		type: 'time',
		value: value && value.end || '',
		'data-time-range-role': 'end'
	});
	var remove = E('button', {
		type: 'button',
		'class': 'cbi-button cbi-button-remove myeqosplus-policy-time-remove'
	}, _('删除'));
	var row = E('div', { 'class': 'myeqosplus-policy-time-row' }, [
		start,
		E('span', { 'class': 'myeqosplus-policy-time-separator' }, _('至')),
		end,
		remove
	]);

	container.appendChild(row);
	remove.addEventListener('click', function() {
		var rows = container.querySelectorAll('.myeqosplus-policy-time-row');
		if (rows.length === 1) {
			start.value = '';
			end.value = '';
			start.focus();
			return;
		}
		container.removeChild(row);
		reindexTimeRangeRows(container);
	});
	reindexTimeRangeRows(container);
}

function collectTimeRanges(form) {
	var rows = form.querySelectorAll('.myeqosplus-policy-time-row');
	var pattern = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
	var ranges = [];
	var seen = {};

	for (var i = 0; i < rows.length; i++) {
		var startField = rows[i].querySelector('[data-time-range-role="start"]');
		var endField = rows[i].querySelector('[data-time-range-role="end"]');
		var start = String(startField.value || '').trim();
		var end = String(endField.value || '').trim();

		if (!start && !end)
			continue;
		if (!start || !end)
			return { error: { elements: [ startField, endField ], focusElement: start ? endField : startField, message: _('第 %d 个时段的开始时间和结束时间必须同时填写。').format(i + 1) } };
		if (!pattern.test(start) || !pattern.test(end))
			return { error: { elements: [ startField, endField ], focusElement: !pattern.test(start) ? startField : endField, message: _('第 %d 个时段格式无效，请使用 HH:MM 格式。').format(i + 1) } };
		if (start === end)
			return { error: { elements: [ startField, endField ], focusElement: startField, message: _('第 %d 个时段的开始时间不能与结束时间相同。').format(i + 1) } };

		var item = start + '-' + end;
		if (seen[item])
			return { error: { elements: [ startField, endField ], focusElement: startField, message: _('第 %d 个时段与已有时段重复。').format(i + 1) } };
		seen[item] = true;
		ranges.push(item);
	}

	return { value: ranges.join(',') };
}

function validatePolicy(values) {
	var ratePattern = /^[0-9]+$/;
	var weekPattern = /^[1-7](,[1-7])*$/;
	var down = String(values.download_kbit || '').trim() || '0';
	var up = String(values.upload_kbit || '').trim() || '0';
	var week = String(values.week || '').trim() || '0';

	if (!ratePattern.test(down) || Number(down) > 100000000)
		return { field: 'download_kbit', message: _('下载限速必须是 0 至 100000000 之间的整数。') };
	if (!ratePattern.test(up) || Number(up) > 100000000)
		return { field: 'upload_kbit', message: _('上传限速必须是 0 至 100000000 之间的整数。') };
	if (Number(down) === 0 && Number(up) === 0)
		return { field: 'download_kbit', fields: [ 'download_kbit', 'upload_kbit' ], message: _('下载和上传限速不能同时为 0，请至少设置一个非零值。') };
	if (week !== '0' && !weekPattern.test(week))
		return { field: 'week', message: _('生效星期格式无效，请重新选择。') };

	values.download_kbit = down;
	values.upload_kbit = up;
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

	var fields = validation.elements || (validation.fields || [ validation.field ]).map(function(name) {
		return policyField(form, name);
	}).filter(Boolean);
	fields.forEach(function(field) {
		field.classList.add('myeqosplus-policy-invalid');
		field.setAttribute('aria-invalid', 'true');
	});

	var focusField = validation.focusElement || policyField(form, validation.field);
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
			var displayName = deviceDisplayName(device, p);
			var edit = E('button', { 'class': 'cbi-button cbi-button-action' }, p.mac ? _('编辑限速') : _('设置限速'));
			edit.addEventListener('click', function() { self.showPolicy(device); });
			table.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, displayName || device.mac), E('br'), E('small', {}, device.mac), E('br'), E('small', {}, state) ]),
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
		var discoveredName = deviceDisplayName(device, null);
		var configuredName = String(p.comment || discoveredName || '').trim();
		var displayName = configuredName || _('未命名设备');
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

		var timeRangesContainer = E('div', {
			id: 'myeqosplus-policy-time-ranges',
			'class': 'myeqosplus-policy-time-ranges',
			'data-policy-field': 'time_ranges'
		});
		parseTimeRanges(p.time_ranges, p.timestart, p.timeend).forEach(function(range) {
			appendTimeRangeRow(timeRangesContainer, range);
		});
		var addTimeRange = E('button', {
			type: 'button',
			'class': 'cbi-button cbi-button-add myeqosplus-policy-time-add'
		}, _('+ 添加时段'));
		addTimeRange.addEventListener('click', function() {
			if (timeRangesContainer.querySelectorAll('.myeqosplus-policy-time-row').length >= MAX_TIME_RANGES) {
				showPolicyToast(_('无法添加时段'), _('每个策略最多支持 %d 个生效时段。').format(MAX_TIME_RANGES), 'warning');
				return;
			}
			appendTimeRangeRow(timeRangesContainer, { start: '', end: '' });
			var rows = timeRangesContainer.querySelectorAll('.myeqosplus-policy-time-row');
			rows[rows.length - 1].querySelector('[data-time-range-role="start"]').focus();
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
			'.myeqosplus-policy-time-ranges{display:flex;flex-direction:column;gap:9px}',
			'.myeqosplus-policy-time-row{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto;align-items:center;gap:10px}',
			'.myeqosplus-policy-time-remove{min-width:64px}',
			'.myeqosplus-policy-time-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
			'.myeqosplus-policy-time-add{white-space:nowrap}',
			'.myeqosplus-policy-help{margin:16px 0 0;padding:10px 12px;border-left:3px solid #5e72e4;background:#f7f8ff;color:#687083;line-height:1.6}',
			'.myeqosplus-policy-inline-help{font-size:.86rem;color:#7a8294;line-height:1.5}',
			'.myeqosplus-policy-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid #e6e9ef}',
			'.myeqosplus-policy-actions .myeqosplus-policy-delete{margin-right:auto}',
			'@media(max-width:600px){.myeqosplus-policy-form{width:calc(100vw - 32px)}.myeqosplus-policy-grid{grid-template-columns:1fr}.myeqosplus-policy-field-full{grid-column:auto}.myeqosplus-policy-device{align-items:flex-start;flex-direction:column}.myeqosplus-policy-time-row{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)}.myeqosplus-policy-time-remove{grid-column:1/-1;width:100%}.myeqosplus-policy-time-separator{text-align:center}.myeqosplus-policy-actions{flex-wrap:wrap}.myeqosplus-policy-actions .myeqosplus-policy-delete{width:100%;margin:0 0 4px}}'
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
					E('label', { 'class': 'myeqosplus-policy-label', 'for': 'myeqosplus-policy-week' }, _('生效星期')),
					weekNode,
					E('div', { 'class': 'myeqosplus-policy-inline-help' }, _('支持多选；选择“每天”会自动取消其他星期，选择具体星期会自动取消“每天”。'))
				]),
				E('div', { 'class': 'myeqosplus-policy-field myeqosplus-policy-field-full' }, [
					E('span', { 'class': 'myeqosplus-policy-label' }, _('生效时段')),
					timeRangesContainer,
					E('div', { 'class': 'myeqosplus-policy-time-tools' }, [
						E('div', { 'class': 'myeqosplus-policy-inline-help' }, _('支持多个时段和跨午夜时段，最多 %d 个；全部留空表示全天生效。').format(MAX_TIME_RANGES)),
						addTimeRange
					])
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
			callPolicy(device.mac, '1', '', '', '', '', '', '', '', '').then(function(result) {
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
			var timeRanges = collectTimeRanges(form);
			if (timeRanges.error) {
				markPolicyInvalid(form, timeRanges.error);
				showPolicyToast(_('参数无效'), timeRanges.error.message, 'warning');
				return;
			}
			values.time_ranges = timeRanges.value;

			var validation = validatePolicy(values);
			if (validation) {
				markPolicyInvalid(form, validation);
				showPolicyToast(_('参数无效'), validation.message, 'warning');
				return;
			}

			save.disabled = true;
			callPolicy(values.mac, '', values.name, values.enabled, values.download_kbit, values.upload_kbit, '', '', values.time_ranges, values.week).then(function(result) {
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



