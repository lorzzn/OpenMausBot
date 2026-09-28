# Local Docker Compose

From the repository root, run `docker compose up -d --build`, then open
http://localhost:8080. Docker with Linux containers is required.
Compose supplies defaults; no `.env` file is required.
The application container uses Docker's init process to reap orphaned agent
subprocesses.

To customize, copy `.env.example` to `.env` in the repository root.
The `.env` file is ignored by Git. Shell environment variables take precedence.
`OMB_HTTP_PORT` changes the host port and the default public URL.
Internal service ports remain fixed inside the shared network namespace.
`ENGINES` selects space-separated npm packages; an empty value skips installation.

For Tailscale Serve, set `OMB_PUBLIC_URL` to your HTTPS URL and
`OMB_HTTPS_HOST` to its hostname without scheme or path. Configure Tailscale
Serve on the host to forward to the chosen localhost HTTP port.
Keep the default `OMB_BIND_ADDRESS=127.0.0.1`. Caddy refuses to start when
`OMB_HTTPS_HOST` is set with any other bind address, so direct remote HTTP
clients cannot claim HTTPS semantics by supplying that hostname.
The hostname mapping preserves HTTPS
semantics for that host while localhost access continues to use HTTP.
Private tailnet webhook URLs are only reachable by callers on that tailnet.
Without `OMB_HTTPS_HOST`, the bind address can be changed for HTTP access.
Only use HTTPS hostname mapping with a trusted local TLS-terminating proxy.

## HTTPS on local IP addresses (no domain)

Browsers reserve APIs such as `crypto.randomUUID()` for secure contexts. For a
browser on another machine, `http://192.168.x.x:8080` is not a secure context.
Use the optional HTTPS overlay to serve the same app at the host's IP addresses:

```sh
./deploy/local/make-https-cert.sh
docker compose -f compose.yaml -f compose.vm.yaml -f compose.https.yaml up -d
```

The script detects all currently active host IPv4 addresses, including LAN and
VPN addresses. It creates a private local CA and one server certificate
containing those addresses, plus `localhost` and `127.0.0.1`. It writes them to
the ignored `.omb-local-tls/` directory; the Docker build context excludes that
directory too. `compose.https.yaml` listens on all host interfaces at port
8443 by default, while keeping the existing HTTP port. HTTP requests to the
detected IPs redirect to HTTPS. Use `OMB_HTTPS_PORT` to change the HTTPS port.
If an IP changes, rerun the script and recreate the `caddy` service with
`docker compose -f compose.yaml -f compose.vm.yaml -f compose.https.yaml up -d --no-deps --force-recreate caddy`.
You can also pass explicit IPv4 addresses to the script.

Each client must trust `.omb-local-tls/rootCA.crt` for the HTTPS origin to be
fully trusted. On Windows, import that certificate into the current user's
**Trusted Root Certification Authorities** store. Keep `rootCA.key` and
`server.key` on the host. Caddy reads the server certificate but not the CA key.
The leaf certificate lasts one year; rerun the script to renew it while keeping
the same root CA. A new root CA requires importing the new certificate on each
client again.

Sign in and pair a browser:

```sh
docker compose exec omb codex login --device-auth
docker compose exec omb node dist-server/openmausbot.js pair
```

## Auto-approve all tools in the web app

Set `OMB_PAIRED_WEB_FULL_ACCESS=1` in `.env`, then recreate the app container.
In a paired admin browser, open a bot's approval selector and choose
**Auto (full access)**. Confirm the warning. Bot settings can apply the choice
to all existing and future threads; the chat composer changes only the current
thread. This mode automatically allows tool permission requests without a
reviewer. Questions and separate OpenMausBot confirmations still need an
answer. The setting is off by default and cannot be granted through the
loopback API or a non-admin paired session.

On Windows, `./maus.ps1` forwards arguments to Compose using the repository
directory. It respects Docker's selected context and `DOCKER_CONTEXT`.

Data and engine credentials persist in the named data volume. For an existing
volume, set `OMB_DATA_VOLUME` to its name and `OMB_DATA_EXTERNAL=true`.
Fresh installs create their volume automatically.

Update with `docker compose build --pull` followed by `docker compose up -d`.
Stop with `docker compose stop`. `docker compose down -v` deletes managed volumes.
