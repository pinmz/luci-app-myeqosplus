'use strict';
'require view';
'require form';
'require rpc';
'require uci';

var callReload = rpc.declare({ object: 'myeqosplus', method: 'reload' });

return view.extend({
	load: function() {
		return uci.load('myeqosplus');
	},

	render: function() {
		var m = new form.Map('myeqosplus', _('My eQoS Plus settings'),
			_('Safe defaults preserve an unmanaged mq, CAKE or SQM root qdisc. The device page combines DHCP, IPv4/IPv6 neighbors, bridge FDB, Wi-Fi stations and Wi-Fi history.'));
		var s = m.section(form.NamedSection, 'main', 'myeqosplus');
		s.anonymous = true;
		s.addremove = false;

		var o = s.option(form.Flag, 'enabled', _('Enable service'));
		o.rmempty = false;

		o = s.option(form.Value, 'wan_network', _('WAN network'));
		o.default = 'wan';
		o.rmempty = false;

		o = s.option(form.Value, 'lan_network', _('LAN network'));
		o.default = 'lan';
		o.rmempty = false;

		o = s.option(form.Value, 'ifname', _('WAN shaping interface'), _('Use auto to resolve the active WAN L3 device, or enter an explicit Linux netdev such as eth0.2 or pppoe-wan.'));
		o.default = 'auto';
		o.placeholder = 'auto';
		o.rmempty = false;

		o = s.option(form.ListValue, 'multiqueue_policy', _('Existing root qdisc'), _('Refuse is recommended. Takeover explicitly replaces the existing root qdisc and may collapse mq to a single HTB root.'));
		o.value('refuse', _('Refuse takeover (recommended)'));
		o.value('takeover', _('Allow takeover'));
		o.rmempty = false;

		o = s.option(form.Flag, 'preserve_existing_qdisc', _('Protect unmanaged qdisc'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'manage_flow_offloading', _('Temporarily disable flow offloading'), _('The original firewall4 values are restored when the service stops, is disabled, or fails to start.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'upload_ceiling_kbit', _('Upload ceiling (kbit/s)'), _('Root ceiling for the WAN egress shaper.'));
		o.datatype = 'uinteger';
		o.default = '1000000';
		o.rmempty = false;

		o = s.option(form.Value, 'download_ceiling_kbit', _('Download ceiling (kbit/s)'), _('Root ceiling for the WAN ingress/IFB shaper.'));
		o.datatype = 'uinteger';
		o.default = '1000000';
		o.rmempty = false;

		o = s.option(form.Value, 'history_retention_days', _('History retention (days)'));
		o.datatype = 'uinteger';
		o.default = '90';

		o = s.option(form.Value, 'refresh_interval', _('Device refresh interval (seconds)'));
		o.datatype = 'uinteger';
		o.default = '30';

		o = s.option(form.Value, 'schema_version', _('Configuration schema version'));
		o.readonly = true;
		o.default = '2';

		return m.render();
	},

	handleSaveApply: function(ev) {
		return this.super('handleSaveApply', [ ev ]).then(function() {
			return callReload();
		});
	}
});