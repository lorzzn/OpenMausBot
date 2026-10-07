ARG BASE_IMAGE=ghcr.io/milind-soni/openmausbot:latest

FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN npm install -g pnpm@10.33.0
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/docs/package.json ./apps/docs/package.json
COPY cloudflare/control-plane/package.json ./cloudflare/control-plane/package.json
COPY scripts/install-git-hooks.mjs ./scripts/install-git-hooks.mjs
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:server && pnpm exec vite build

FROM ${BASE_IMAGE}
USER root
ARG ENGINES="@anthropic-ai/claude-code @openai/codex"
RUN if [ -n "$ENGINES" ]; then npm install -g $ENGINES; fi
# Grok Build from xAI's own installer, pinned and installed the same way as
# the Cloud image (the Dockerfile's cloud-home target); it signs in from the
# app with a device code into ~/.grok on the data volume. GROK_VERSION= leaves
# it out.
ARG GROK_VERSION=1.0.41
RUN if [ -n "$GROK_VERSION" ]; then \
      mkdir -p /tmp/grok-install \
      && curl -fsSL https://x.ai/cli/install.sh -o /tmp/grok-install/install.sh \
      && HOME=/tmp/grok-install PATH="/tmp/grok-install/.grok/bin:$PATH" bash /tmp/grok-install/install.sh "$GROK_VERSION" \
      && install -m 0755 "$(readlink -f /tmp/grok-install/.grok/bin/grok)" /usr/local/bin/grok \
      && HOME=/tmp/grok-install grok --version | grep -qF "grok $GROK_VERSION " \
      && rm -rf /tmp/grok-install; \
    fi
USER maus
COPY --from=build --chown=maus:maus /src/dist-server /app/dist-server
COPY --from=build --chown=maus:maus /src/dist /app/dist
COPY --from=build --chown=maus:maus /src/package.json /app/package.json
CMD ["node", "dist-server/server-launcher.js"]
