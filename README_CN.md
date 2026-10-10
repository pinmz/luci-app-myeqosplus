# luci-app-myeqosplus

My eQoS Plus 是基于 `luci-app-eqosplus` 重构的 OpenWrt 25.12 LuCI 应用，服务和配置全部使用 `myeqosplus` 命名空间，避免与原 `luci-app-eqosplus` 并行安装时互相覆盖。

## 主要功能

- 展示当前设备和历史设备：无线、DHCP、有线 bridge FDB、IPv4/IPv6 邻居表；
- 可选导入 `luci-app-wifihistory` 的历史设备数据；
- 设备以规范化 MAC/device_id 绑定策略，不依赖临时 IPv4 地址；
- 在设备列表中直接设置上传/下载 kbit/s、启用状态、星期多选和多个生效时段；
- 离线设备可以先保存策略，设备再次上线后由轻量后台更新器应用；
- nftables `inet myeqosplus` 标记同时覆盖 IPv4/IPv6；
- 默认保留已有 `mq` 根并对每个硬件子队列建立独立 HTB；CAKE、SQM 等非 `mq` 根 qdisc 仍拒绝接管，显式设置 `multiqueue_policy=takeover` 才允许替换；
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
        option multiqueue_policy 'refuse' # 安全默认值
        option multiqueue_mode 'preserve' # 保留 mq 根并按硬件子队列限速
        option manage_flow_offloading '1'
        option history_retention_days '90'
        option refresh_interval '30'
```

`multiqueue_mode=preserve`（默认）发现接口根 qdisc 为 `mq` 时会保留根队列，并按硬件队列数量建立独立 HTB；发现 CAKE、SQM 或其它未被本服务标记的非 `mq` 根 qdisc 时，`multiqueue_policy=refuse` 会拒绝启动，只有明确设置为 `takeover` 才会删除并替换。启动前会保存 flow offloading，停止、禁用或异常回滚时恢复。

设备策略使用 `time_ranges` 保存多个生效时段，例如 `09:00-10:00,12:00-14:00`；空值表示全天。每条策略最多支持 8 个时段，支持 `23:00-02:00` 这类跨午夜范围。升级时会把旧的 `timestart`/`timeend` 自动迁移到新字段。

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

## MQ 多队列限速

默认 `multiqueue_mode=preserve`。当 WAN 设备已有 `mq` 根 qdisc 时，本包不会删除或塌缩根队列，而是：

- 读取硬件发送队列（`:1`、`:2` 等），为每个子队列安装独立的 HTB；如果 mq 根存在但无法识别任何硬件子队列，则拒绝启动，避免退化成伪多队列；
- 使用设备 MAC（IP 策略使用地址）稳定哈希到一个硬件队列；
- 使用 nftables mark + `tc fw` 将设备流量送入对应 HTB；
- 使用 egress `skbedit queue_mapping` 将上传流量固定到对应 MQ 子队列；
- 下载方向继续通过 IFB 使用单个 HTB，避免 ingress 方向无法直接选择硬件发送队列。

上传总上限按 `upload_ceiling_kbit / mq 队列数` 分配到各队列，保证所有队列聚合不会超过配置上限；当单设备策略高于所属队列预算时，会安全地限制为该队列预算。设备没有 MQ 根 qdisc 时才使用单 HTB 根；已有 CAKE、SQM 或其它非 `mq` 根默认拒绝接管，只有显式设置 `multiqueue_policy=takeover` 才会替换。设置 `multiqueue_mode=single` 可强制单队列。停止、禁用或启动失败时只清理由本包创建的子队列、过滤器和 clsact，并尽可能恢复原 MQ 子 qdisc 及其参数。
