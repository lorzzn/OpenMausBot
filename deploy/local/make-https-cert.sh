#!/bin/sh
# Create a private local CA and an IP-SAN certificate for compose.https.yaml.
# Keep the CA key on this host; copy only rootCA.crt to client devices.
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cert_dir="$repo_root/.omb-local-tls"
umask 077
mkdir -p "$cert_dir"

if [ "$#" -eq 0 ]; then
  if ! command -v ip >/dev/null 2>&1; then
    echo "Install iproute2 or pass the IP addresses explicitly." >&2
    exit 2
  fi
  # Include every currently active non-loopback IPv4 address, including VPNs.
  detected_ips=$(ip -o -4 addr show up scope global | awk '{sub(/\/.*/, "", $4); print $4}')
  if [ -z "$detected_ips" ]; then
    echo "No active IPv4 addresses found; pass IP addresses explicitly." >&2
    exit 2
  fi
  set -- $detected_ips
fi

san='DNS:localhost,IP:127.0.0.1'
redirect_hosts=''
for task_ip do
  case "$task_ip" in
    ''|*[!0-9.]*)
      echo "Expected an IPv4 address, got: $task_ip" >&2
      exit 2
      ;;
  esac
  if ! printf '%s\n' "$task_ip" | awk -F. 'NF != 4 { exit 1 } { for (i = 1; i <= 4; i++) if ($i == "" || length($i) > 3 || $i + 0 > 255) exit 1 }'; then
    echo "Invalid IPv4 address: $task_ip" >&2
    exit 2
  fi
  san="$san,IP:$task_ip"
  redirect_hosts="$redirect_hosts $task_ip"
done

if [ ! -e "$cert_dir/rootCA.key" ] || [ ! -e "$cert_dir/rootCA.crt" ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 \
    -keyout "$cert_dir/rootCA.key" -out "$cert_dir/rootCA.crt" \
    -subj '/CN=OpenMausBot Local CA' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' >/dev/null 2>&1
fi

cat > "$cert_dir/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EOF

openssl req -new -newkey rsa:2048 -nodes -sha256 \
  -keyout "$cert_dir/server.key" -out "$cert_dir/server.csr" \
  -subj '/CN=OpenMausBot Local HTTPS' >/dev/null 2>&1
openssl x509 -req -in "$cert_dir/server.csr" \
  -CA "$cert_dir/rootCA.crt" -CAkey "$cert_dir/rootCA.key" \
  -CAcreateserial -out "$cert_dir/server.crt" -days 365 -sha256 \
  -extfile "$cert_dir/server.ext" >/dev/null 2>&1
openssl verify -CAfile "$cert_dir/rootCA.crt" "$cert_dir/server.crt"

cat > "$cert_dir/http-redirect.caddy" <<EOF
@https_ips host$redirect_hosts
redir @https_ips https://{host}:{\$OMB_HTTPS_PORT:8443}{uri} 308
EOF

echo "Local HTTPS certificate covers: 127.0.0.1 localhost$redirect_hosts"
echo "Install $cert_dir/rootCA.crt on each client device to trust it."
echo "Keep $cert_dir/rootCA.key private."
