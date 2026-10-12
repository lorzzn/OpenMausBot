# 定制分支维护、上游同步与部署交接

这份文档供维护本项目的人和后续编码代理使用。它记录本仓库的定制、两套现有部署、同步步骤与验证方法。
涉及运行状态的记录截至 **2026-10-12（北京时间）**；操作前应重新读取容器标签、端口和 Git 状态，不能把这份快照当成实时状态。

## 1. 仓库与本次同步基线

| 项目 | 值 |
| --- | --- |
| 本机源码目录 | `/home/zhipeng/codes/OpenMausBot` |
| 定制分支 | `feature/zpmodified` |
| 自有远端 `origin` | `git@github.com:lorzzn/OpenMausBot.git` |
| 官方远端 `upstream` | `https://github.com/milind-soni/OpenMausBot.git` |
| 合并前的定制分支提交 | `e9fe8f8cd` |
| 上次合并提交 | `7b4834d22`，2026-10-08，v0.1.101 |
| 上次纳入的上游提交 | `ff2b02e5eba604d225d46fef1ccf31450f176c7b` |
| 本次纳入的上游提交 | `1b5877a6f19a6c9229d12c2a3cb1f3efb1b01bd2` |
| 本次源码合并提交 | `87bfbfd4643d3da790fd692fd29f45ed104431b1` |
| 本次源码版本 | `0.1.107`，包含该正式版本发布后的 main 更新 |

本次同步把上游合并到定制分支，保留两边历史。源码合并、Git 提交、推送和运行服务更新是四个不同的动作。
**本次同步不代表两台机器已运行新版本。** 本次核对时，本机和 50 的应用容器仍是 **0.1.101**。

上游在本次范围内新增了持久化任务运行机制，并已把 `coordinate_bots` 接入，替换旧的 `room-handoffs` 树。
新机制的权限继承、任务状态、取消、等待用户输入、重启恢复和旧记录迁移都属于合并时必须检查的路径。
部分其他委派路径仍在后续迁移计划内，不能仅凭版本号认为整个迁移已经完成。

## 2. 必须保留的定制

| 定制 | 主要位置 | 合并时需要保留的行为 |
| --- | --- | --- |
| 网页流式显示 | `src/state/streaming.ts`、`src/state/store.tsx`、`src/components/StreamingReply.tsx`、`ChatView.tsx`、`GroupView.tsx` | 按 thread 订阅文本和 reasoning；完成时清空缓冲；切换聊天、后台页面和暂停 rAF 时不丢尾部、不重复回复 |
| 流式代码块渲染 | `src/components/ChatMarkdown.tsx` | 流式阶段延迟高亮；同时采用上游的超大代码块纯文本策略、公式按需加载和附件渲染 |
| 网页 Full Access | `shared/approval-mode.ts`、`server/auto-approve.ts`、`server/index.ts`、权限选择组件 | 配对管理员在服务器开启功能后可以选择 Full Access；所有支持的引擎自动批准工具请求；用户问题仍需回答 |
| Cursor 面板安装／登录／更新 | `server/drivers/cursor-{auth,install,release}.ts`、`server/drivers/acp/cursor.ts`、`server/harness/registry.ts`、`CursorSignIn.tsx`、`EngineSetup.tsx` | 按需安装，网页完成官方登录，检测版本并原生更新；优先使用实例 HOME 内安装的 CLI，不依赖镜像预装 |
| Cursor／Antigravity 套餐用量 | `server/plan-usage.ts`、`PlanUsage.tsx`、相关 fixture | 显示提供方返回的窗口、月度额度、模型池和重置时间；不可获取时显示真实状态，不编造额度 |
| VM 查看地址 | `server/local-vm-viewer.ts`、查看器路由 | 浏览器使用当前访问源／代理信息生成地址；局域网、Tunnel、宿主机 HTTPS 都不跳到客户端的 `127.0.0.1` |
| 单端口 HTTP 部署 | `compose.yaml`、`server/index.ts` | Docker 直连应用 8799；应用自身处理 `/hooks/` 和经过认证的桌面查看器，不依赖 Caddy 容器 |
| HTTP UUID 兼容 | `src/lib/crypto-compat.ts`、`src/main.tsx` | 非安全 HTTP 源缺少 `crypto.randomUUID` 时使用 `getRandomValues`；HTTPS 的原生实现保持原样 |
| 大工具输出的聊天投影 | `server/tool-title.ts`、`server/index.ts`、`server/store.ts` | 工具标题显示上限 2048 字符，公开聊天投影不携带庞大原始字段；避免含大量图片／长命令的聊天一次传输数百万字符 |
| 可选宿主机文件挂载 | `compose.mnt.yaml` | `/mnt` 以读写方式提供给应用，使用 `rslave` 传播后续挂载；不自动提供给 Local VM 桌面 |
| 应用目录内的 CLI 更新 | `server/drivers/cli-update-command.ts`、`server/engine-install.ts`、`server/index.ts` | Claude 等 npm 安装的引擎更新应用实际使用的副本，避免更新到另一个全局 prefix |

### Full Access 与 Auto 的区别

- `full` 是用户已选择的“直接批准工具”模式，既可以由引擎执行，也可以由 harness 回答残留权限请求。
- `auto` 仍表示提供方原生的安全审核，不能因为某引擎支持 `full` 就假定它也有原生审核器。
- `OMB_PAIRED_WEB_FULL_ACCESS=1` 允许配对管理员使用网页 Full Access；它不会把每个现有 Bot 自动改成 Full。
- Bot、thread 和新 Bot 的预设各有自己的设置。修改预设不等于修改所有旧 Bot。
- 新任务运行机制会计算主管与目标 Bot 的有效权限，并限制权限继承的来源。外部请求不应被当成人的 Full Access 授权。
- 新增引擎时，同时核对 `shared/approval-mode.ts`、驱动权限处理和 `server/runtime/capabilities.test.ts`。不能只改能力声明。

### Cursor 注意事项

Cursor 不需要在构建／启动 Docker 时预装。在“模型提供方／引擎”的 Cursor 卡片里安装、登录、检查更新。
CLI 和身份信息保存在容器的持久 HOME `/data`，更新镜像不应把它们清掉。
实例显式设置 CLI 路径时应尊重该路径；默认情况优先使用 `/data/.local` 下的安装。
详情参见 [Cursor 文档](cursor.md)。

本次纳入上游的 ACP 模型与推理强度映射修复。`--model` 参数本身不能证明 ACP 实际用了该模型；需要检查 session 模型选择、提示信息和相关 fake CLI 测试。

## 3. 当前部署在哪里

两套安装相互独立：**数据库、Bot、聊天、引擎登录、浏览器会话和 VM 文件不能互相复制覆盖。**

| 项目 | 本机 | 50（VPS） |
| --- | --- | --- |
| 主机 | 当前开发电脑 | `108.186.129.50` |
| 源码目录 | `/home/zhipeng/codes/OpenMausBot` | `/opt/OpenMausBot` |
| 核对时源码 HEAD | 同步前 `e9fe8f8cd`，本次提交后会推进 | `e9fe8f8cd`，尚未纳入本次同步 |
| 核对时应用版本 | `0.1.101` | `0.1.101` |
| 对外地址 | `https://omb.oomdev.de5.net/` | `https://ombus.oomdev.de5.net/` |
| Docker 主机端口 | `0.0.0.0:8080 → 8799` | `127.0.0.1:8080 → 8799` |
| 公网入口 | Cloudflare Tunnel | 宿主机 systemd Caddy |
| OMB 容器 | `omb`、`dind`、`cloudflared` | `omb`、`dind` |
| 运行中的 Compose | `compose.yaml` + `compose.vm.yaml` + `compose.tunnel.yaml` | `compose.yaml` + `compose.vm.yaml` + `compose.mnt.yaml` |
| Caddy 容器 | 未启用 | 未启用 |
| IP 自签 HTTPS overlay | 未启用 | 未启用 |

### 本机

当前 `.env` 设置 `OMB_BIND_ADDRESS=0.0.0.0`、`OMB_HTTP_PORT=8080`、`OMB_PUBLIC_URL=https://omb.oomdev.de5.net`、`OMB_PAIRED_WEB_FULL_ACCESS=1`。
Tunnel 与应用共享网络命名空间，连接 **`http://127.0.0.1:8799`**，Cloudflare 负责公网 TLS。
Tunnel Token 位于被 Git 忽略的 `.omb-cloudflare/tunnel-token`。不需要把 Token 放进 Compose、文档或命令行。
直接 HTTP 和 Tunnel 访问同一套本机数据；不同浏览器或不同访问源会有各自的登录状态。

### 50：宿主机 Caddy

访问链路：

```text
https://ombus.oomdev.de5.net:443
  → 宿主机 Caddy
  → http://127.0.0.1:8080
  → Docker 应用监听 0.0.0.0:8799
```

50 的 `.env` **省略** `OMB_BIND_ADDRESS` 和 `OMB_HTTP_PORT`，使用基础 Compose 默认值 `127.0.0.1`、`8080`。
`OMB_PUBLIC_URL` 与 `OMB_WEBHOOK_PUBLIC_URL` 都是 `https://ombus.oomdev.de5.net`，网页 Full Access 功能标志已开启。
应用的 `OMB_LISTEN_HOST=0.0.0.0` 是容器内部设置，不代表宿主机把 8799 或 8080 暴露到公网。

宿主机 Caddy 的配置是 `/etc/caddy/Caddyfile`，`caddy.service` 已启用开机启动。
它也服务 **Orca**（现有 IP 6768 与 `orcaus.oomdev.de5.net`）；改 OMB 路由时必须保留这些站点。
OMB 的有效配置片段如下，已写在宿主机现有文件中，没有另建仓库里的 `Caddyfile.host`：

```caddyfile
http://ombus.oomdev.de5.net {
    redir https://ombus.oomdev.de5.net{uri} 308
}

ombus.oomdev.de5.net {
    tls {
        issuer acme
    }
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
    }
}
```

Caddy 申请并续期公网证书。原有全局配置关闭自动 HTTP 跳转，所以 OMB 有自己的显式 HTTP 跳转。
宿主机曾核对为 Caddy 2.6.2：不能直接把较新版本的 `tls force_automate` 简写复制进去，须用实际安装的二进制验证配置。
正常路由更新先 `caddy validate`，再 `systemctl reload caddy`，让现有 Caddy 进程重新加载。
无需为了应用更新重装或重启宿主机网关。

DNS 是 `ombus.oomdev.de5.net → 108.186.129.50` 的 A 记录，现有部署使用直连、Cloudflare DNS 代理关闭。
修改应用镜像不需要重新创建 DNS、Tunnel 或申请域名 API Token。

### 50 的 `/mnt` 与包装命令差异

2026-10-12 核对发现：运行中容器的 Compose 标签包含 **`compose.mnt.yaml`**，但 `/usr/local/bin/omb-compose` 包装命令只列出了基础与 VM 两个文件。
所以 **下一次部署 50 应显式包含 `compose.mnt.yaml`**，保留已经启用的 `/mnt` 挂载。
维护包装命令时使它与运行栈一致；不要因执行旧包装命令而无意移除挂载。本次源码同步只记录这个差异，没有更改 50 的包装命令或运行栈。

## 4. Compose 文件的分工

| 需要的能力 | 使用的文件 | 说明 |
| --- | --- | --- |
| 纯 HTTP | `compose.yaml` | 默认映射 `127.0.0.1:8080:8799`，没有 Caddy |
| Cloudflare Tunnel | 基础 + `compose.tunnel.yaml` | Tunnel 直接访问应用，公网是 HTTPS |
| IP 自签 HTTPS | 基础 + `compose.https.yaml` | 先运行 `deploy/local/make-https-cert.sh`，启动可选 Caddy 容器；默认 HTTPS 8443 |
| Caddy 容器的域名 HTTPS | 基础 + `compose.domain.yaml` | 设置 `OMB_DOMAIN`，由可选 Caddy 容器使用 80/443 |
| 现有宿主机网关 | 基础 Compose + 宿主机配置 | 50 使用此方式，**不叠加**域名或 IP HTTPS overlay |
| 本地桌面能力 | 任一方式 + `compose.vm.yaml` | 启动专用 Docker daemon `dind`；桌面容器按需创建启动 |
| 应用访问宿主机 `/mnt` | 任一方式 + `compose.mnt.yaml` | 仅在需要时加入，50 已启用 |

端口写法是 **宿主机地址:宿主机端口:容器端口**。`OMB_HTTP_PORT` 默认 `8080`，`OMB_BIND_ADDRESS` 默认 `127.0.0.1`。
`OMB_PUBLIC_URL` 控制展示给人的链接、公开地址等信息；它不控制监听地址，也不代替 DNS 或网关配置。
修改 `.env` 后需重新创建受影响容器。不要只修改文件就认为运行中的环境已经改变。
更多通用选项见 [Docker 部署说明](../deploy/local/README.md)。

## 5. 数据与运维约束

- Compose 项目名通常是 `openmausbot`；应用容器是 `openmausbot-omb-1`。
- 应用持久 HOME 是 `/data`；数据目录是 `/data/.openmausbot`。
- 两台机器各自使用同名的 `openmausbot_data` 数据卷。名称相同不代表数据相同。
- VM daemon 使用 `openmausbot_vm_socket` 和 `openmausbot_vm_docker_data`。共享的是它自己的 Unix socket，不是宿主机的 Docker socket。
- VM 桌面工作区与应用使用 UID/GID `1000:1000`。挂载目录的实际权限应保持可用；不要为解决一次 Git 提示而对全部数据改所有者。
- 50 使用独立的邮箱验证码登录与独立引擎账号。正常部署核对容器、健康接口和端口，不反复发送登录验证码、不生成配对码。
- **50 不制作数据备份，不保留旧应用镜像，不保留上传的安装包／构建归档。** 这是现有运维偏好；本机可以保留用于恢复的代码与镜像。
- 镜像清理必须针对本次替换的旧应用镜像。不要执行全局 `docker system prune` 去清掉其他项目或 VM 所需资源。
- 不运行 `docker compose down -v` 删除工作数据，也不删除整个持久 HOME 来解决租约或登录问题。
- 不向应用容器里的 PID 7 或猜测的 PID 发送 `SIGHUP`。PID 会改变；这种操作会切断任务，并可能与锁／租约及恢复逻辑互相影响。
- 应用通过 `server-launcher.js` 启动，Compose 使用 `init: true` 和 `restart: unless-stopped`。正常镜像更新用同一套 Compose 的 `up -d` 重新创建容器；计划重启可用 `restart`，保留 Docker 的正常停止流程。
- 配对、邮箱登录、引擎身份及密钥都保存在运行环境里。SSH 密码、API Key、Tunnel Token、私钥和 Cookie **不写入 Git 或此文档**。

## 6. 以后如何同步上游

### 6.1 确认工作区与同步范围

```sh
cd /home/zhipeng/codes/OpenMausBot
git status --short --branch
git remote -v
git log --first-parent --merges -5 --oneline
git fetch upstream main --tags
git log --oneline HEAD..upstream/main
git diff --stat HEAD...upstream/main
```

首先确认当前分支为 `feature/zpmodified`。如果有用户未提交修改，先识别归属并保留；不要用 `reset --hard`、`clean -fd` 或把用户修改当成同步废料。
用下面的命令得到真正共同基线。上次 merge 的第二个父提交也可用于确认当时纳入的上游范围。

```sh
git merge-base HEAD upstream/main
git show -s --format='%H%n%P%n%B' HEAD
git show -s --format='%H%n%P%n%B' <上次同步的合并提交>
```

版本号不足以判断更新范围：上游可能已经在正式发布后合入新机制，但 `package.json` 仍沿用该发布版本。
记下本次目标的**完整 SHA**，后续验证与提交针对这个固定目标；不要在处理中不断更换合并目标。

### 6.2 准备恢复点并合并

工作区干净时，可在本机创建一个代码恢复分支，名字带上实际日期，方便找回同步前的定制。
这只保存 Git 提交，不复制服务数据，也不属于在 50 制作数据备份。

```sh
git branch safety/before-upstream-YYYYMMDD
git merge --no-ff --no-commit <固定的上游SHA>
git diff --name-only --diff-filter=U
```

如果单独用 worktree 处理，同步提交应最终回到 `feature/zpmodified`；不要让使用者停留在临时同步分支。
仍处于合并中且确实需要重新开始时，使用 `git merge --abort`，先确保合并前的用户修改已经保留。

### 6.3 按行为处理冲突

不要对整个 `server/index.ts`、`ChatView.tsx` 或权限文件直接选择 ours／theirs。逐块保留上游的新机制与第 2 节列出的定制。

- **流式与 Markdown**：保留文本／reasoning 的 thread 订阅和完成清理，同时接入新的附件、回复操作、未读状态、性能限制和懒加载插件。
- **Cursor 安装与检测**：同时保留上游的安装失败原因与本分支的实际 CLI 解析；检测和运行必须使用同一个实例 HOME 下的可执行文件。
- **安装结果**：“请求成功”不足以显示“已安装”；保留上游对返回引擎状态的验证，也要保留 Cursor 原生安装／更新入口。
- **任务权限**：运行时能力测试要体现本分支的 Full Access。保持未知引擎拒绝提升权限、外部请求不继承主管授权、Auto 仍要求原生审核器的测试。
- **验证 launcher**：新增位置参数后核对所有调用者，尤其是网页静态目录与本分支的隔离配对管理员测试参数，避免把 boolean 当成路径。
- **路由计数 gate**：核对 `/hooks/`、VM 授权和配对 Full Access 路由。上游移走旧路由时降低对应计数；不要删测试、放宽成任意计数。
- **翻译**：按 JSON 键进行三方合并，保留新增字段。英文变化后同步审阅译文与 `source-hashes.json`；不要只接受哈希却不读译文。
- **已有测试失败**：先看错误是否来自具体冲突、测试夹具或 Node／CLI 环境。修正真实原因，保留有效断言，避免用延时／跳过／重试掩盖功能问题。

处理后确认 Git 无未解决文件、源码中没有冲突标记。

```sh
git diff --check
git diff --name-only --diff-filter=U
```

## 7. 验证方式

以 [验证总说明](verification/README.md) 和根目录 `AGENTS.md` 为准。
**所有会发送消息、创建 Bot、改权限或登录状态的验证必须使用隔离 fixture，不能指向用户的真实运行数据。**

### 7.1 工具版本与静态检查

仓库要求 Node.js **24 或更新版本**，使用 `package.json` 规定的 pnpm（当前 `10.33.0`）。
本机默认 shell 的 Node 版本不一定符合要求；先检查 `node --version`，必要时使用已经安装的 Node 24。
`.omb-scratch/upstream-sync-tools` 是这台开发电脑已有的本地工具路径，不能假定每台机器都有它。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm i18n:check
pnpm check:electron
```

只需要服务器／前端验证且不运行 Electron 时，可以为依赖安装设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`。
运行 Electron 测试时仍需要可执行的 Electron，不应把缺少二进制误判成应用回归。

### 7.2 隔离服务器与有针对性的回归

前台运行 launcher，使用其输出的 URL：

```sh
node --experimental-strip-types scripts/control-omb.ts launch
pnpm control:omb doctor --url http://127.0.0.1:<fixture端口>
```

完成后对该前台 launcher 按 Ctrl-C，让它停止自己拥有的子进程并删除临时数据。不要按进程名批量 kill。

推荐根据此次变更选择测试：

```sh
pnpm exec vitest run \
  server/approval-mode.test.ts \
  server/drivers/acp/approval-matrix.test.ts \
  server/drivers/acp/cursor.test.ts \
  server/harness/registry.test.ts \
  server/plan-usage.test.ts \
  server/plan-usage-cursor-antigravity.test.ts \
  server/runtime/capabilities.test.ts \
  server/runtime/level.test.ts \
  server/runtime-coordinator.test.ts \
  src/state/streaming.test.ts \
  src/components/ApprovalModeSelector.test.ts \
  scripts/testing/index-route-ratchet.test.ts
```

涉及持久化任务机制时，再检查 runtime 协作、重启恢复、配对 Full Access 等隔离端到端测试。
涉及聊天渲染和流式缓冲时，按 [Chat UI recipe](verification/chat-ui.md) 执行真实渲染器验证：

```sh
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/stream-buffer.e2e.test.ts
```

Cursor／Antigravity 套餐展示使用 [plan usage fixture](verification/plan-usage.md)，供应商响应是模拟数据，不会扣费或触碰真实账号。

### 7.3 构建与配置检查

```sh
pnpm build:server
pnpm exec vite build
node scripts/smoke-packaged-server.mjs

docker compose -f compose.yaml -f compose.vm.yaml config --quiet
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml config --quiet
OMB_DOMAIN=fixture.example.com docker compose -f compose.yaml -f compose.vm.yaml -f compose.domain.yaml config --quiet
docker compose -f compose.yaml -f compose.vm.yaml -f compose.https.yaml config --quiet
```

Tunnel 配置检查需要有效的 `OMB_PUBLIC_URL`；IP HTTPS 真正启动前需要已有证书文件。配置解析成功不等于所有部署方式都完成了线上验证。
构建时不应读取实际 `.env`、Tunnel Token 或证书私钥到镜像；这些目录由 `.dockerignore` 排除。

### 7.4 完成同步提交

```sh
git add <已解决的文件与文档>
git diff --cached --check
git commit
git status --short --branch
git merge-base --is-ancestor <本次上游SHA> HEAD
```

合并提交说明写清：上游目标、保留的定制、关键冲突、实际通过的检查以及未完成的部署。
需要推送时向自己的 `origin/feature/zpmodified` 推送。现有 pre-push hook 会检查 lint、typecheck 和翻译；不要为省时间默认跳过。

## 8. 同步代码后如何部署

只有在用户要求更新服务时，才把新源码部署到对应机器。不要因为代码已合并就写“线上已更新”。
先记录当前容器、镜像 ID、Compose 文件标签、数据卷和挂载。只读取与部署有关的环境字段，避免输出完整环境及密钥。

### 8.1 本机服务

当前使用基础 + VM + Tunnel：

```sh
cd /home/zhipeng/codes/OpenMausBot
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml config --quiet
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml build omb
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml up -d --no-build --remove-orphans
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml ps
curl --fail http://127.0.0.1:8080/api/health
curl --fail https://omb.oomdev.de5.net/api/health
```

`deploy/local/Dockerfile.vm` 从源码构建 UI／server，再使用现有 `openmausbot-local:latest` 运行时。
如果上游新增运行时依赖，核对编译是否把它内联、是否有原生外部依赖，以及基础镜像是否包含它们。
本次新增 DuckDB、resvg 等依赖。两份本地 Dockerfile 都运行上游的 `prepare-duckdb.mjs`，把当前平台的原生资源复制到 `/app/duckdb`，并设置 `OMB_DUCKDB_DIR`。
部署时应以最终镜像的隔离启动检查为准；仅有本机 TypeScript 构建成功不足以证明镜像依赖完整。
需要刷新基础运行时时，先构建基础，再构建 VM 应用镜像：

```sh
docker build -f deploy/local/Dockerfile -t openmausbot-local:latest .
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml build omb
```

`--pull` 是主动更新基础镜像的选择，不应每次部署都无意切换基础版本。

### 8.2 50 服务

SSH 到 `root@108.186.129.50` 后核对 `/opt/OpenMausBot`。源码有本机已不在的临时补丁时，先核对差异，再推进到对应提交；不要强制覆盖。
如果 root 读已有工作目录触发 Git 的 dubious ownership，先确认仓库的实际归属。对已确认目录可使用单次 `git -c safe.directory=/opt/OpenMausBot ...`；不要把所有路径都设为可信。

50 当前实际栈包含 `/mnt`，使用完整命令：

```sh
cd /opt/OpenMausBot
docker compose -f compose.yaml -f compose.vm.yaml -f compose.mnt.yaml config --quiet
docker compose -f compose.yaml -f compose.vm.yaml -f compose.mnt.yaml build omb
docker compose -f compose.yaml -f compose.vm.yaml -f compose.mnt.yaml up -d --no-build --remove-orphans
docker compose -f compose.yaml -f compose.vm.yaml -f compose.mnt.yaml ps
curl --fail http://127.0.0.1:8080/api/health
curl --fail https://ombus.oomdev.de5.net/api/health
```

不要叠加 `compose.domain.yaml`、`compose.https.yaml` 或 `compose.tunnel.yaml`：该机器当前入口是已存在的宿主机 Caddy。
更新应用并且域名／端口未变时，Caddy 路由无需改动。确实改网关配置时验证完整 `/etc/caddy/Caddyfile`，然后 reload。

如果选择上传本机构建结果，必须同时包含正确的 server、UI 和需要的原生运行时依赖，检查版本与文件哈希；不能仅复制 `dist-server/index.js` 就认为升级完整。
成功后清理本次上传的临时构建归档和被替换的旧应用镜像；保留当前镜像、基础镜像、dind 和其他项目所需镜像。

### 8.3 部署完成的证据

- 实际运行容器健康，启动后没有持续增加的 `RestartCount`。
- 容器内 `/app/package.json` 是目标源码版本，同时记录实际镜像 ID／源码 SHA；相同版本号可能对应不同 main 提交。
- 本机仍包含 Tunnel；50 仍是 loopback 8080 + 宿主机 HTTPS，并保留 `/mnt`。
- 数据卷与 UID/GID 正确，其他宿主机 Caddy 站点仍存在。
- 健康接口能经预期公网入口访问。普通部署不再额外验证邮箱登录。
- 明确记录是哪一台已更新，另一台是否仍在旧版本；不把 Git 已推送等同于容器已更新。

## 9. 交接记录维护

每次同步或部署后更新本文的基线／状态日期，或追加日期条目，至少记录：

1. 定制分支提交与上游完整 SHA、包版本。
2. 解决的冲突和保留的关键行为。
3. 实际通过的命令、隔离 fixture 证据位置及验证限制。
4. 两台机器实际运行的版本、镜像、Compose 列表、端口和公开地址。
5. 是否已推送、是否已部署，以及仍待处理的差异。

临时测试日志可留在 Git 忽略的 `.omb-scratch/` 或 fixture 打印的证据目录，但后续维护者应从这份仓库文档就能了解主要事实。
不要让关键运维流程只存在于聊天记录或 50 上某个仓库外的临时 Compose 文件里。

## 10. 本次实际执行记录（2026-10-12）

源码合并提交为 `87bfbfd46`。本次解决了 15 个文件的合并冲突，重点保留流式上下文与清理、Cursor 原生 CLI 解析、配对管理员 Full Access 和本地部署方式。
新运行机制的能力／权限测试已经覆盖本分支对 ACP／Pi 引擎的 Full Access，以及未知引擎、非主管和外部来源的权限边界。
安装测试的独立 PATH 提供测试 runner 的 Node，只执行 fake npm；没有调用真实引擎安装或用户账号。

| 检查 | 结果 |
| --- | --- |
| TypeScript、Lint、翻译 | 通过；10 个语言包、4064 条英文源字符串 |
| Electron 语法 | 161 个模块通过检查 |
| 定向单元／协议测试 | 23 个文件、335 项通过 |
| 权限、协作恢复与界面回归 | 12 个文件、388 项通过，包含隔离服务器端到端场景 |
| ACP 安装／版本探测 | 2 个文件、14 项通过 |
| 真实浏览器流式缓冲 | 1 项通过，验证暂停 rAF 后完整显示和结束时无重复 |
| server 与 UI 构建 | 通过；UI 构建仍有上游的大 chunk 提示 |
| 包装后 server smoke | 通过，在仓库与 node_modules 之外验证启动、代理入口、MCP、隔离备份 worker 与 launcher |
| Compose | 四种入口组合解析通过，另外核对了 `/mnt` overlay |
| 原生资源准备 | 上游脚本成功准备 Linux x64 的 DuckDB 1.5.6-r.1 与 resvg |
| 隔离运行时镜像 | 使用本次编译的 server／UI／原生资源，在现有基础镜像上构建临时镜像；应用健康、真实 SQL 查询、PNG 渲染通过 |

合计 **738 项定向测试通过**。未运行整个跨平台 `pnpm test`，未执行真实付费引擎调用，未用用户的数据、Bot 或邮箱登录做修改性验证。

完整 `deploy/local/Dockerfile.vm` 多阶段构建曾在 npm 下载阶段出现持续低速及 `ECONNRESET`，本次停止了该下载构建。
因此完整 Dockerfile 从头到尾的构建不列为通过；已通过的是源码构建、官方原生资源准备脚本以及这些制品组成的隔离运行时镜像。
下次实际部署前仍要完成目标机器上的正式镜像构建或经过核对的制品发布，不能把这个临时验证镜像当成服务已升级。

原始日志存放在本机被 Git 忽略的 `.omb-scratch/upstream-sync-20261012/`，包括 `targeted.log`、`workflows.log`、`acp-probes.log`、`stream-ui.log`、`packaged.log` 与 `native-check.json`。
隔离 foreground fixture、流式测试拥有的服务器／浏览器和临时运行容器已经清理。SSH 临时凭据已经删除。
**本次没有重部署本机或 50，两端仍运行 0.1.101；50 的 `/mnt` 包装命令差异仍需在下次部署时处理。**
