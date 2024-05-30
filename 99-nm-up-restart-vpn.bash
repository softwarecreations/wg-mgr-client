#!/bin/bash
# useful on a laptop or system where network interfaces go up/down

[[ $1 != wg_* && $1 != tun_* && $2 = up ]] && {
	#echo "$(date) Restarting VPN $@" >> /tmp/99-nm-up-restart-vpn.log
	systemctl restart wg-quick@wg_router ssh nginx mongod wg-mgr-client
}

# ln -s /opt/wg-mgr-client/99-nm-up-restart-vpn.bash /etc/NetworkManager/dispatcher.d/
