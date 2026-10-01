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

Cursor is installed on demand from **Settings → Engines → Cursor → Install
Cursor on this server**. Building or starting the Docker image does not download
Cursor. The panel downloads the version currently advertised by Cursor's
official installer, validates its executable, and stores it under
`/data/.local/share/cursor-agent` with a `cursor-agent` shim in `/data/.local/bin`.
Installation needs neither a container rebuild nor a restart, and does not
replace a generic `agent` command belonging to another engine.

Then choose **Connect Cursor**. Open
the official authorization link and sign in; the page confirms completion and
refreshes models automatically. This works from a remote browser without a
localhost callback or a terminal. To use the terminal instead:

```sh
docker compose exec -e NO_OPEN_BROWSER=1 omb cursor-agent login
```

Open the printed login URL in your browser and finish the Cursor account login.
The credentials stay in the persistent `/data` home across container recreation.
Normal engine status checks also detect new versions and display the same
update notice used by other engines. Release checks are cached for one hour;
failed checks retry after five minutes. Use the notice's update button, or
**CLI path and updates → Update Cursor on this server**, to run the native
`cursor-agent update` command. It follows Cursor's configured release channel;
new versions and their shim are written under `/data/.local` and persist across
container recreation. Running
Cursor tasks must finish first. An explicit custom CLI path stays pinned; reset
that override to use page installation and updates.
An instance can also use `CURSOR_API_KEY` or `CURSOR_AUTH_TOKEN`; see
[Cursor setup](../../docs/cursor.md).

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

## Cloudflare Tunnel for this installation

`compose.tunnel.yaml` adds a remotely managed Cloudflare Tunnel for
`https://omb.oomdev.de5.net`. Keep the existing `compose.https.yaml`: the
connector shares the app container's network namespace and reaches Caddy at
`https://localhost:443`. Its local TLS certificate is checked against the
existing private CA, while browsers see Cloudflare's public HTTPS certificate.
The existing host ports `8080` (HTTP) and `8443` (local HTTPS) stay published on
all interfaces. They and the public hostname lead to the same app and data.

In Cloudflare, make sure `oomdev.de5.net` is available as a zone. Create a
remotely managed Tunnel under **Networking → Tunnels**. Add a proxied DNS CNAME
for `omb.oomdev.de5.net` pointing to
`19cebe5b-cf49-497e-b694-4585196878cf.cfargotunnel.com` (replace the UUID
if recreating the Tunnel). This installation's DNS record is already present.
The only credential needed on this machine is the Tunnel Token from the
Tunnel's installation or **Add a replica** command. Save only the
`eyJ...` token by running `./deploy/local/save-tunnel-token.sh` in a terminal;
the input is hidden. It goes to the Git-ignored `.omb-cloudflare/tunnel-token`
with mode 0600. Do not paste the token into `compose.tunnel.yaml`, `.env`, a
command argument, or a chat message. By default `cloudflared` runs as UID/GID
1000 to read that file and `rootCA.crt`; set `OMB_TUNNEL_UID` and
`OMB_TUNNEL_GID` to the token file owner's numeric IDs if they differ.

Start or update the stack from the repository root:

```sh
docker compose -f compose.yaml -f compose.vm.yaml -f compose.https.yaml -f compose.tunnel.yaml up -d
```

This dedicated Tunnel uses the connector's local `--url` and TLS flags, so a
Cloudflare **Published application** route is not required while the Tunnel has
no remotely configured ingress rules. If you later add one in the dashboard,
set its Service URL to `https://localhost:443`, Origin Server Name to
`localhost`, CA Pool to `/etc/cloudflared/rootCA.crt`, and leave TLS certificate
verification enabled. A remote route may take precedence over the local URL.

Check `docker compose -f compose.yaml -f compose.vm.yaml -f compose.https.yaml -f compose.tunnel.yaml ps`
and open `https://omb.oomdev.de5.net`. This overlay sets `OMB_PUBLIC_URL` and
`OMB_WEBHOOK_PUBLIC_URL` to that public origin for new links and webhook URLs;
it does not change the local IP listeners. A browser using the new hostname
has a separate cookie and must sign in once by email or pair once.

For browser-only access, an optional Cloudflare Access self-hosted application
can restrict this exact hostname to specific email addresses before the
request reaches OpenMausBot. That is separate from OpenMausBot's own login.
If external webhooks will call `/hooks/`, give that path a deliberate Access
policy instead of assuming browser login covers machines. Use a named Tunnel:
Quick Tunnels do not support the SSE stream that carries live replies.

Data and engine credentials persist in the named data volume. For an existing
volume, set `OMB_DATA_VOLUME` to its name and `OMB_DATA_EXTERNAL=true`.
Fresh installs create their volume automatically.

Update with `docker compose build --pull` followed by `docker compose up -d`.
Stop with `docker compose stop`. `docker compose down -v` deletes managed volumes.
