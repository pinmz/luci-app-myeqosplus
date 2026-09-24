include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-myeqosplus
PKG_VERSION:=2.0.0
PKG_RELEASE:=8
PKG_MAINTAINER:=My eQoS Plus Team
PKG_LICENSE:=GPL-2.0-only

LUCI_TITLE:=LuCI support for My eQoS Plus
LUCI_DESCRIPTION:=Device inventory, Wi-Fi history, wired discovery and IPv4/IPv6 QoS control.
LUCI_DEPENDS:=+luci-base +ip +ip-bridge +tc +nftables +kmod-ifb +kmod-sched-core +iw +iwinfo +jsonfilter +rpcd +rpcd-mod-ucode +ucode +ucode-mod-fs +ucode-mod-uci +ucode-mod-ubus
LUCI_PKGARCH:=all

# Depend on the virtual ip/tc providers so the package can coexist with the
# router's selected ip-tiny/tc-tiny variants. The implementation only uses
# core iproute2/tc features; it does not require tc-full's xtables extensions.

# The legacy implementation is stored outside root/ and is not part of the package.
# The explicit install allow-list below prevents accidental path collisions.

# One-time migration is intentionally performed by a package script, not by
# Makefile evaluation, so SDK builds never touch the builder's UCI database.
define Package/$(PKG_NAME)/conffiles
/etc/config/myeqosplus
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
if [ -x /usr/libexec/myeqosplus-migrate ]; then
	/usr/libexec/myeqosplus-migrate || exit 1
fi
/etc/init.d/myeqosplus enable >/dev/null 2>&1 || true
rm -f /tmp/luci-* /tmp/luci-modulecache.*
/etc/init.d/rpcd reload >/dev/null 2>&1 || true
exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/myeqosplus stop >/dev/null 2>&1 || true
exit 0
endef

define Package/$(PKG_NAME)/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
rm -rf /var/run/myeqosplus /var/myeqosplus.idlist
/etc/init.d/rpcd reload >/dev/null 2>&1 || true
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk
# Install an explicit allow-list.  This is intentional: the fork keeps the
# original implementation under root/ for reference, but it must never be
# copied into the generated package or overwrite luci-app-eqosplus files.
define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/hotplug.d/iface $(1)/etc/init.d
	$(INSTALL_DIR) $(1)/usr/bin $(1)/usr/sbin $(1)/usr/libexec
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d $(1)/usr/share/rpcd/acl.d $(1)/usr/share/rpcd/ucode
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/myeqosplus
	$(INSTALL_CONF) ./root/etc/config/myeqosplus $(1)/etc/config/myeqosplus
	$(INSTALL_BIN) ./root/etc/hotplug.d/iface/10-myeqosplus $(1)/etc/hotplug.d/iface/10-myeqosplus
	$(INSTALL_BIN) ./root/etc/init.d/myeqosplus $(1)/etc/init.d/myeqosplus
	$(INSTALL_BIN) ./root/usr/bin/myeqosplus $(1)/usr/bin/myeqosplus
	$(INSTALL_BIN) ./root/usr/bin/myeqosplusctrl $(1)/usr/bin/myeqosplusctrl
	$(INSTALL_BIN) ./root/usr/sbin/myeqosplus-devices $(1)/usr/sbin/myeqosplus-devices
	$(INSTALL_BIN) ./root/usr/libexec/myeqosplus-migrate $(1)/usr/libexec/myeqosplus-migrate
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-myeqosplus.json $(1)/usr/share/luci/menu.d/luci-app-myeqosplus.json
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-myeqosplus.json $(1)/usr/share/rpcd/acl.d/luci-app-myeqosplus.json
	$(INSTALL_DATA) ./root/usr/share/rpcd/ucode/myeqosplus.uc $(1)/usr/share/rpcd/ucode/myeqosplus.uc
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/myeqosplus/devices.js $(1)/www/luci-static/resources/view/myeqosplus/devices.js
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/myeqosplus/settings.js $(1)/www/luci-static/resources/view/myeqosplus/settings.js
endef


# luci.mk owns the normal copy/prepare sequence.  Do not redefine
# Build/Prepare after including luci.mk, otherwise root/ and htdocs/ are not
# copied into PKG_BUILD_DIR on OpenWrt 25.12.

$(eval $(call BuildPackage,$(PKG_NAME)))
