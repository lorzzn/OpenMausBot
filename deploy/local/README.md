# Local Docker Compose

From the repository root, run `docker compose up -d --build`, then open
http://localhost:8080. Docker with Linux containers is required.
Compose supplies defaults; no `.env` file is required.
Plain HTTP runs only the application container: Docker maps the host port
directly to the app's HTTP listener at `0.0.0.0:8799` inside the container.
The host binding remains `127.0.0.1` by default; set `OMB_BIND_ADDRESS=0.0.0.0`
to allow LAN or remote access. `OMB_PUBLIC_URL` controls advertised links,
not which host addresses may connect. The ordinary CLI and desktop app still
listen on loopback unless `OMB_LISTEN_HOST` is explicitly set.
The app handles `/hooks/` on this same port and serves its authenticated
desktop viewer itself. Neither needs a Caddy container. Adding `compose.vm.yaml`
starts the dedicated Docker daemon for Local VM desktops.

## Deployment modes

All four modes use repository files. Choose one row; `compose.vm.yaml` can
be added to any row when Local VM desktops are needed.

| Access mode | Compose files | Gateway |
| --- | --- | --- |
| Plain HTTP | `compose.yaml` | None; host port → app port 8799 |
| Cloudflare Tunnel | `compose.yaml` + `compose.tunnel.yaml` | Cloudflared → app port 8799; no Caddy |
| Self-signed IP HTTPS | `compose.yaml` + `compose.https.yaml` | Caddy with generated local certificate |
| Public-domain HTTPS | `compose.yaml` + `compose.domain.yaml` | Caddy with automatic public certificate |

Plain HTTP needs no extra overlay to select its port. For a public server
serving HTTP on port 80, set these values in `.env`:

```dotenv
OMB_BIND_ADDRESS=0.0.0.0
OMB_HTTP_PORT=80
OMB_PUBLIC_URL=http://ombus.oomdev.de5.net
```

Then run `docker compose -f compose.yaml -f compose.vm.yaml up -d --remove-orphans`
(omit `compose.vm.yaml` if the VM daemon is not needed). This publishes port
80 directly to 8799. The default local installation uses port 8080 instead.
Use `--remove-orphans` when switching modes to remove unused gateway containers.

## Application image and settings

The application container uses Docker's init process to reap orphaned agent
subprocesses. The upstream server launcher also handles requested application
restarts inside the same container, keeping Caddy and the Tunnel attached to
the shared network namespace. Docker stops forward SIGTERM to the server for
its normal cleanup.

To customize, copy `.env.example` to `.env` in the repository root.
The `.env` file is ignored by Git. Shell environment variables take precedence.
`OMB_HTTP_PORT` changes the host port and the default public URL.
Internal service ports remain fixed inside the shared network namespace.
`ENGINES` selects space-separated npm packages; an empty value skips installation.
The image also carries Grok Build, pinned by `GROK_VERSION` in
`deploy/local/Dockerfile`; Grok and Codex sign in from the app's engine setup
with a one-time code, no terminal needed.

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

For Tailscale Serve, set `OMB_PUBLIC_URL` to your HTTPS URL and configure
Serve on the host to forward to the chosen localhost HTTP port, preserving
the external scheme and host in forwarded headers.
Keep the default `OMB_BIND_ADDRESS=127.0.0.1` when using a local HTTPS proxy.
Private tailnet webhook URLs are only reachable by callers on that tailnet.

## HTTPS on local IP addresses (no domain)

The renderer supplies a UUID fallback using secure random bytes on HTTP
origins. Browser features that require a secure context, such as microphone
access, still need HTTPS. The optional HTTPS overlay adds a Caddy container
and serves the same app at the host's IP addresses:

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

## HTTPS on a public domain

`compose.domain.yaml` is an independent domain HTTPS overlay. It does not
require `compose.https.yaml` or files in `.omb-local-tls/`.
Set a bare hostname in `.env`, for example:

```dotenv
OMB_DOMAIN=ombus.oomdev.de5.net
```

Point the domain's DNS A/AAAA records at this server and allow inbound TCP
ports 80 and 443. Start the stack from the repository root:

```sh
docker compose -f compose.yaml -f compose.vm.yaml -f compose.domain.yaml up -d --remove-orphans
```

This mode replaces the plain HTTP port mapping with ports 80/443 for Caddy
and keeps the app listener private at `127.0.0.1:8799`. It automatically sets
both advertised public URLs to `https://<OMB_DOMAIN>`. Caddy obtains and
renews the domain certificate and redirects HTTP to HTTPS using its
[automatic HTTPS](https://caddyserver.com/docs/automatic-https) support.
Certificates and renewal state persist in the `caddy_data` volume.
The default HTTP/TLS challenges need no DNS API token.

Choose either the domain overlay or the self-signed IP overlay. They select
different certificates and port mappings for the same optional Caddy service.
Plain HTTP and Tunnel mode do not start that service.

## Terminal sign-in

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

`compose.tunnel.yaml` adds a remotely managed Cloudflare Tunnel. Set
`OMB_PUBLIC_URL` in `.env` to its public HTTPS URL, for example
`https://omb.oomdev.de5.net`. The connector shares the app container's network
namespace and reaches the app directly at `http://127.0.0.1:8799`.
Cloudflare provides the browser's public HTTPS certificate; no local TLS
certificate or Caddy container is needed. The host HTTP port stays published
according to `OMB_BIND_ADDRESS`; it and the public hostname lead to the same
app and data. Add `compose.https.yaml` only when local IP HTTPS is also needed.

In Cloudflare, make sure your domain is available as a zone. Create a
remotely managed Tunnel under **Networking → Tunnels**. Add a proxied DNS CNAME
for your chosen hostname pointing to `<tunnel-ID>.cfargotunnel.com`.
This local installation's existing `omb.oomdev.de5.net` DNS record is already
present and does not need to be recreated.
The only credential needed on this machine is the Tunnel Token from the
Tunnel's installation or **Add a replica** command. Save only the
`eyJ...` token by running `./deploy/local/save-tunnel-token.sh` in a terminal;
the input is hidden. It goes to the Git-ignored `.omb-cloudflare/tunnel-token`
with mode 0600. Do not paste the token into `compose.tunnel.yaml`, `.env`, a
command argument, or a chat message. By default `cloudflared` runs as UID/GID
1000 to read that file; set `OMB_TUNNEL_UID` and
`OMB_TUNNEL_GID` to the token file owner's numeric IDs if they differ.

Start or update the stack from the repository root:

```sh
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml up -d --remove-orphans
```

This dedicated Tunnel uses the connector's local `--url`, so a
Cloudflare **Published application** route is not required while the Tunnel has
no remotely configured ingress rules. If you later add one in the dashboard,
set its Service URL to `http://127.0.0.1:8799`. A remote route may take
precedence over the local URL.

Check `docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml ps`
and open the configured public HTTPS URL. This overlay uses `OMB_PUBLIC_URL`
for new links and, unless separately set, `OMB_WEBHOOK_PUBLIC_URL` for webhooks.
It does not change the local IP listeners. A browser using the new hostname
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
