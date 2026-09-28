#!/usr/bin/env bash
# Save a remotely managed Cloudflare Tunnel token without echoing it or putting
# it in shell history, Compose environment variables, or command arguments.
set -euo pipefail

if [[ ! -t 0 ]]; then
  echo "Run this script in a terminal so the token can be entered privately." >&2
  exit 2
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
token_dir="$repo_root/.omb-cloudflare"
token_path="$token_dir/tunnel-token"
umask 077
install -d -m 0700 "$token_dir"

if ! IFS= read -r -s -p 'Paste Cloudflare Tunnel Token (hidden): ' token; then
  printf '\n' >&2
  exit 2
fi
printf '\n'
if [[ ! "$token" =~ ^eyJ[A-Za-z0-9._+/=-]+$ ]]; then
  echo "That does not look like a Cloudflare Tunnel Token (expected eyJ...)." >&2
  exit 2
fi

temporary=$(mktemp "$token_dir/.tunnel-token.XXXXXXXX")
trap 'rm -f -- "$temporary"' EXIT
printf '%s\n' "$token" > "$temporary"
mv -f -- "$temporary" "$token_path"
chmod 0600 "$token_path"
unset token
echo "Tunnel Token saved privately to $token_path"
