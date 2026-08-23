#!/usr/bin/env sh
set -eu

readonly CHAIN='NETRIN-AI-EGRESS'
readonly SUBNET='172.31.248.0/28'

iptables -C DOCKER-USER -s "$SUBNET" -j "$CHAIN"
iptables -C "$CHAIN" -p tcp --dport 443 -m conntrack --ctstate NEW -j ACCEPT
iptables -C "$CHAIN" -j REJECT

container_ip="$(docker inspect netrin-ai-orchestrator --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
test "$container_ip" = '172.31.248.2'

docker exec netrin-ai-orchestrator node -e \
  "fetch('https://api.deepseek.com/').then(()=>process.exit(0)).catch(()=>process.exit(1))"

if docker exec netrin-ai-orchestrator node -e \
  "fetch('http://example.com/',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))"
then
  echo 'plain HTTP egress unexpectedly succeeded' >&2
  exit 1
fi

if docker exec netrin-ai-orchestrator node -e \
  "fetch('https://10.0.0.1/',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))"
then
  echo 'private HTTPS egress unexpectedly succeeded' >&2
  exit 1
fi
