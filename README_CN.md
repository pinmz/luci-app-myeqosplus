# luci-app-myeqosplus

My eQoS Plus 是基于 `luci-app-eqosplus` 重构的 OpenWrt 25.12 LuCI 应用，服务和配置全部使用 `myeqosplus` 命名空间，避免与原 `luci-app-eqosplus` 并行安装时互相覆盖。

## 主要功能

- 展示当前设备和历史设备：无线、DHCP、有线 bridge FDB、IPv4/IPv6 邻居表；
- 可选导入 `luci-app-wifihistory` 的历史设备数据；
- 设备以规范化 MAC/device_id 绑定策略，不依赖临时 IPv4 地址；
- 在设备列表中直接设置上传/下载 kbit/s、启用状态和时间计划；
- 离线设备可以先保存策略，设备再次上线后由轻量后台更新器应用；
- nftables `inet myeqosplus` 标记同时覆盖 IPv4/IPv6；
- 默认拒绝接管已有 `mq`、CAKE、SQM 等根 qdisc，显式设置 `multiqueue_policy=takeover` 才接管；
- 启动前保存 firewall4 flow offloading 原值，停止、禁用或失败回滚时恢复；
- 通过 `/usr/bin/myeqosplus` 统一管理 nftables、tc、IFB 和策略；
- 通过 `/usr/sbin/myeqosplus-devices` 提供 `refresh/list/status` 设备发现接口。

## LuCI 页面

安装后打开：

```text
/cgi-bin/luci/admin/control/myeqosplus/devices
```

高级设置：

```text
/cgi-bin/luci/admin/control/myeqosplus/settings
```

## OpenWrt SDK 编译

将本目录放入 SDK 的 `package/luci-app-myeqosplus`，然后执行：

```sh
make defconfig
make package/luci-app-myeqosplus/compile V=s
```

Makefile 显式注册 `BuildPackage`，并使用安装白名单；即使 fork 源码目录中保留旧文件作为参考，生成的包也不会安装旧服务、旧 ACL、旧 controller 或旧 LuCI view。

## 运行时配置

```uci
config myeqosplus 'main'
        option enabled '0'
        option ifname 'auto'               # 自动解析 WAN L3 设备
        option wan_network 'wan'
        option lan_network 'lan'
        option wan_network 'wan'
        option lan_network 'lan'
        option multiqueue_policy 'refuse' # 安全默认值
        option manage_flow_offloading '1'
        option history_retention_days '90'
        option refresh_interval '30'
```

`refuse` 模式发现接口根 qdisc 为 `mq` 或其它未被本服务标记的 qdisc 时会拒绝启动并保留原规则；只有明确设置为 `takeover` 才会删除并替换根 HTB。启动前会保存 flow offloading，停止或异常回滚时恢复。

## 设备发现数据

运行时文件：

```text
/var/run/myeqosplus/devices.current
/etc/myeqosplus/devices.history
```

手工检查：

```sh
/usr/sbin/myeqosplus-devices refresh
/usr/sbin/myeqosplus-devices list
/usr/sbin/myeqosplus-devices status
/usr/bin/myeqosplus status-json
```

历史设备不会因为离线而被删除；`history_retention_days` 控制历史记录清理。策略只绑定 MAC，因 DHCP 地址变化或 IPv6 地址变化不会丢失。

## 与原包隔离

本包安装的关键路径为（仅列出本包白名单内容）：

```text
/etc/config/myeqosplus
/etc/init.d/myeqosplus
/usr/bin/myeqosplus
/usr/bin/myeqosplusctrl
/usr/sbin/myeqosplus-devices
/usr/share/luci/menu.d/luci-app-myeqosplus.json
/usr/share/rpcd/ucode/myeqosplus.uc
/www/luci-static/resources/view/myeqosplus/devices.js
/www/luci-static/resources/view/myeqosplus/settings.js
/usr/share/rpcd/acl.d/luci-app-myeqosplus.json
```

升级时仅对旧 `/etc/config/eqosplus` 的 `device` 段执行一次迁移，不删除原包的配置和服务。实际部署时请确保不要同时让原包和本包接管同一接口根 qdisc。
