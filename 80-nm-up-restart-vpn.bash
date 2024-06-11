#!/bin/bash
# useful on a laptop or system where network interfaces go up/down

#echo "$@" >> /tmp/80-nm-up-restart-vpn.log

[[ $1 != wg_* && $1 != tun_* && $2 = up ]] && {
	#echo "$(date) Waiting for internet access... $@" >> /tmp/80-nm-up-restart-vpn.log
	while ! ping -c1 -w1 1.1.1.1 | grep -q 'bytes from'; do :; done
	#echo "$(date) Restarting VPN $@" >> /tmp/80-nm-up-restart-vpn.log
	systemctl restart wg-mgr-client
}

# ln -s /opt/wg-mgr-client/80-nm-up-restart-vpn.bash /etc/NetworkManager/dispatcher.d/; chmod u+x /opt/wg-mgr-client/80-nm-up-restart-vpn.bash
