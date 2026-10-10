'use strict';
'require view';
'require form';
'require ui';
'require rpc';
'require uci';

var callReload = rpc.declare({ object: 'myeqosplus', method: 'reload' });

return view.extend({
	load: function() {
		return uci.load('myeqosplus');
	},

	render: function() {
		var m = new form.Map('myeqosplus', _('设备限速增强版设置'),
			_('安全默认设置会保留未由本服务管理的 MQ、CAKE 或 SQM 根 qdisc。设备页面会整合 DHCP、IPv4/IPv6 邻居、网桥 FDB、Wi-Fi 客户端和 Wi-Fi 历史记录。'));
		var s = m.section(form.NamedSection, 'main', 'myeqosplus');
		s.anonymous = true;
		s.addremove = false;

		var o = s.option(form.Flag, 'enabled', _('启用服务'));
		o.rmempty = false;

		o = s.option(form.Value, 'wan_network', _('WAN 网络'));
		o.default = 'wan';
		o.rmempty = false;

		o = s.option(form.Value, 'lan_network', _('LAN 网络'));
		o.default = 'lan';
		o.rmempty = false;

		o = s.option(form.Value, 'ifname', _('WAN 限速接口'), _('使用 auto 自动解析当前 WAN 三层设备，或填写明确的 Linux 网络接口，例如 eth0.2 或 pppoe-wan。'));
		o.default = 'auto';
		o.placeholder = 'auto';
		o.rmempty = false;

		o = s.option(form.ListValue, 'multiqueue_policy', _('已有根 qdisc'), _('控制是否接管未由本服务管理的根 qdisc 或 ingress qdisc。保留模式可以在不删除现有 MQ 根 qdisc 的情况下进行限速。'));
		o.value('refuse', _('拒绝接管（推荐）'));
		o.value('takeover', _('允许接管'));
		o.rmempty = false;

		o = s.option(form.ListValue, 'multiqueue_mode', _('队列模式'), _('保留现有 MQ 根 qdisc，并在每个子队列上应用确定性的硬件队列 HTB。'));
		o.value('preserve', _('保留 MQ，并为每个队列配置 HTB'));
		o.value('auto', _('自动'));
		o.value('single', _('单一 HTB 根队列'));
		o.default = 'preserve';
		o.rmempty = false;

		o = s.option(form.Flag, 'preserve_existing_qdisc', _('保护未由本服务管理的 qdisc'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'manage_flow_offloading', _('启用限速时临时关闭流量分载'), _('服务停止、禁用或启动失败时，将恢复 firewall4 原有的流量分载配置。'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'upload_ceiling_kbit', _('上传总上限（kbit/s）'), _('WAN 出站限速器的根级速率上限。'));
		o.datatype = 'uinteger';
		o.default = '1000000';
		o.rmempty = false;

		o = s.option(form.Value, 'download_ceiling_kbit', _('下载总上限（kbit/s）'), _('WAN 入站/IFB 限速器的根级速率上限。'));
		o.datatype = 'uinteger';
		o.default = '1000000';
		o.rmempty = false;

		o = s.option(form.Value, 'history_retention_days', _('历史记录保留天数'));
		o.datatype = 'uinteger';
		o.default = '90';

		o = s.option(form.Value, 'refresh_interval', _('设备刷新间隔（秒）'));
		o.datatype = 'uinteger';
		o.default = '30';

		o = s.option(form.Value, 'schema_version', _('配置架构版本'));
		o.readonly = true;
		o.default = '2';

		return m.render();
	},

	handleSaveApply: function(ev) {
		return this.super('handleSaveApply', [ ev ]).then(function() {
			return callReload().then(function(result) {
				if (!result || !result.success)
					throw new Error('服务重载失败');
			}).catch(function(err) {
				console.error('myeqosplus 服务重载失败：', err);
				ui.addNotification(null, E('p', {}, _('配置已保存，但服务重载失败，请检查 rpcd 服务。')), 'error');
			});
		});
	}
});