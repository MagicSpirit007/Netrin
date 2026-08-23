#!/usr/bin/env sh
set -eu

readonly CHAIN='NETRIN-AI-EGRESS'
readonly SUBNET='172.31.248.0/28'

if ! iptables -n -L DOCKER-USER >/dev/null 2>&1; then
  echo 'DOCKER-USER chain is unavailable; start Docker before applying the Netrin AI firewall' >&2
  exit 1
fi

iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"

iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

for destination in \
  0.0.0.0/8 \
  10.0.0.0/8 \
  100.64.0.0/10 \
  127.0.0.0/8 \
  169.254.0.0/16 \
  172.16.0.0/12 \
  192.0.0.0/24 \
  192.0.2.0/24 \
  192.168.0.0/16 \
  198.18.0.0/15 \
  198.51.100.0/24 \
  203.0.113.0/24 \
  224.0.0.0/4 \
  240.0.0.0/4
do
  iptables -A "$CHAIN" -d "$destination" -j REJECT
done

iptables -A "$CHAIN" -p tcp --dport 443 -m conntrack --ctstate NEW -j ACCEPT
iptables -A "$CHAIN" -j REJECT

iptables -C DOCKER-USER -s "$SUBNET" -j "$CHAIN" 2>/dev/null || \
  iptables -I DOCKER-USER 1 -s "$SUBNET" -j "$CHAIN"
