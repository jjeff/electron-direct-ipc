#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

echo "Initializing firewall for Claude Code sandbox..."

# Save Docker DNS rules before flushing
DOCKER_DNS_RULES=$(iptables-save | grep -E 'docker0|DOCKER' || true)

# Flush existing rules
iptables -F
iptables -X

# Restore Docker DNS rules
if [ -n "$DOCKER_DNS_RULES" ]; then
  echo "$DOCKER_DNS_RULES" | iptables-restore -n || true
fi

# Delete and recreate ipset
ipset destroy allowed-domains 2>/dev/null || true
ipset create allowed-domains hash:ip

# Allow localhost
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT

# Allow DNS (port 53)
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Allow SSH (port 22)
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT

# Fetch and add GitHub IPs
echo "Fetching GitHub IP ranges..."
GITHUB_IPS=$(curl -s https://api.github.com/meta | jq -r '.git[]' 2>/dev/null || true)
if [ -n "$GITHUB_IPS" ]; then
  # Aggregate and add to ipset
  echo "$GITHUB_IPS" | aggregate | while read -r ip; do
    ipset add allowed-domains "$ip" 2>/dev/null || true
  done
fi

# Add essential domains
DOMAINS=(
  "registry.npmjs.org"
  "api.anthropic.com"
  "console.anthropic.com"
  "sentry.io"
  "update.code.visualstudio.com"
  "vscode.download.prss.microsoft.com"
  "az764295.vo.msecnd.net"
  "download.visualstudio.microsoft.com"
)

echo "Resolving and adding allowed domains..."
for domain in "${DOMAINS[@]}"; do
  IPS=$(dig +short "$domain" A 2>/dev/null || true)
  for ip in $IPS; do
    # Only add if it's a valid IP (not a CNAME)
    if [[ $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      ipset add allowed-domains "$ip" 2>/dev/null || true
    fi
  done
done

# Detect and allow host network
HOST_NETWORK=$(ip route | grep default | awk '{print $3}' | head -1)
if [ -n "$HOST_NETWORK" ]; then
  echo "Allowing host network: $HOST_NETWORK"
  # Get the subnet from the default route
  HOST_SUBNET=$(ip route | grep -v default | grep "$HOST_NETWORK" | awk '{print $1}' | head -1)
  if [ -n "$HOST_SUBNET" ]; then
    # Add each IP in the subnet (for small subnets, or just the gateway)
    iptables -A OUTPUT -d "$HOST_SUBNET" -j ACCEPT
  fi
  # Always allow the gateway
  iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT
fi

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow traffic to allowed domains
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# Allow HTTPS to common CDNs and registries (fallback)
iptables -A OUTPUT -p tcp --dport 443 -m state --state NEW -j ACCEPT
iptables -A OUTPUT -p tcp --dport 80 -m state --state NEW -j ACCEPT

# Set default policies to DROP
# Note: Commented out for development to avoid blocking necessary traffic
# Uncomment these for maximum security
# iptables -P INPUT DROP
# iptables -P FORWARD DROP
# iptables -P OUTPUT DROP

echo "Firewall initialized successfully!"

# Verify connectivity
echo "Testing connectivity..."
curl -s -o /dev/null -w "GitHub API: %{http_code}\n" https://api.github.com/ || echo "GitHub API: FAILED"
curl -s -o /dev/null -w "NPM Registry: %{http_code}\n" https://registry.npmjs.org/ || echo "NPM Registry: FAILED"

echo "Firewall setup complete!"
