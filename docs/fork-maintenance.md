# 定制分支维护、上游同步与部署交接

这份文档供维护本项目的人和后续编码代理使用。它记录本仓库的定制、两套现有部署、同步步骤与验证方法。
涉及运行状态的记录截至 **2026-10-26（北京时间）**；操作前应重新读取容器标签、端口和 Git 状态，不能把这份快照当成实时状态。

## 1. 仓库与本次同步基线

| 项目 | 值 |
| --- | --- |
| 本机源码目录 | `/home/zhipeng/codes/OpenMausBot` |
| 定制分支 | `feature/zpmodified` |
| 自有远端 `origin` | `git@github.com:lorzzn/OpenMausBot.git` |
| 官方远端 `upstream` | `https://github.com/milind-soni/OpenMausBot.git` |
| 合并前的定制分支提交 | `fa4d23f52b2d0974beb9fea8ff9b536413c1230e` |
| 上次合并提交 | `f345225a6dacde8e4248e6ad0755e0bfba8c8c5e`，0.1.116 |
| 上次纳入的上游提交 | `c216147c3710e012941739a24d36cabaf3c62a8d` |
| 本次纳入的上游提交 | `0d8eacc65cd3b783a0d28d019d39e6367780b911` |
| 本次合并提交／运行制品源码 | `74485aa665feb15da60e032f150dd0be5bcac3dc` |
| 本次源码版本 | `0.1.127` |
| 本次合并所在分支 | `feature/zpmodified` |

本次同步固定纳入 **999 个上游提交**（含 merge，607 个非合并提交），涉及 1932 个上游文件。
范围包括手机与设备工具、桌面更新与恢复、Custom ACP 的模型和推理选项、MCP Apps 以及聊天与连接应用界面更新。
保留本分支的流式显示、Cursor 严格参数设置与安装／登录／更新、套餐用量、独立 Codex 设备码账号，以及 Docker／VM／网盘挂载。

最近一次同步与两端发布见第 22 节；账号功能见第 17 节，Cursor 参数适配见第 19 节。第 10—21 节保留历史记录。
本机和 50 均已部署 0.1.127，制品来自 `74485aa665feb15da60e032f150dd0be5bcac3dc`。
后续仅更新部署文档的提交不改变镜像内的制品源码 SHA。

## 2. 必须保留的定制

| 定制 | 主要位置 | 合并时需要保留的行为 |
| --- | --- | --- |
| 网页流式显示 | `src/state/streaming.ts`、`src/state/store.tsx`、`src/components/StreamingReply.tsx`、`ChatView.tsx`、`GroupView.tsx` | 按 thread 订阅文本和 reasoning；完成时清空缓冲；切换聊天、后台页面和暂停 rAF 时不丢尾部、不重复回复 |
| 流式代码块渲染 | `src/components/ChatMarkdown.tsx` | 流式阶段延迟高亮；同时采用上游的超大代码块纯文本策略、公式按需加载和附件渲染 |
| 上游统一 Full Access | `shared/approval-mode.ts`、ACP／Pi 驱动、`server/runtime/capabilities.test.ts` | 0.1.111 已涵盖 Kimi、Droid、Hermes、Pi、Custom ACP；不恢复 fork 的引擎白名单或旧授权桥接；真实用户问题仍需回答 |
| Cursor 面板安装／登录／更新 | `server/drivers/cursor-{auth,install,release}.ts`、`server/drivers/acp/cursor.ts`、`server/harness/registry.ts`、`CursorSignIn.tsx`、`EngineSetup.tsx` | 按需安装，网页完成官方登录，检测版本并原生更新；优先使用实例 HOME 内安装的 CLI，不依赖镜像预装 |
| Cursor 模型参数 | `server/drivers/acp/cursor-model.ts`、`server/drivers/acp/core.ts` | 协商参数化接口，使用提供方元数据映射模型与参数；每轮显式设置 Fast 开关，不自动换模型、不回读核验配置结果 |
| Cursor／Antigravity 套餐用量 | `server/plan-usage.ts`、`PlanUsage.tsx`、相关 fixture | 显示提供方返回的窗口、月度额度、模型池和重置时间；不可获取时显示真实状态，不编造额度 |
| ChatGPT 账号类型 | `shared/codex-account.ts`、`server/drivers/codex-account.ts`、`server/routes/instances.ts`、`EngineAccounts.tsx` | 添加账号时明确选择“Codex 设备码登录”或“ChatGPT plan”；登录、运行、模型、用量、退出使用同一账号目录，不自动切换认证流程 |
| VM 查看地址 | `server/local-vm-viewer.ts`、`server/routes/computers.ts`、查看器路由 | 浏览器使用当前访问源／代理信息生成地址；局域网、Tunnel、宿主机 HTTPS 都不跳到客户端的 `127.0.0.1` |
| 单端口 HTTP 部署 | `compose.yaml`、`server/index.ts` | Docker 直连应用 8799；应用自身处理 `/hooks/` 和经过认证的桌面查看器，不依赖 Caddy 容器 |
| HTTP UUID 兼容 | `src/lib/crypto-compat.ts`、`src/main.tsx` | 非安全 HTTP 源缺少 `crypto.randomUUID` 时使用 `getRandomValues`；HTTPS 的原生实现保持原样 |
| 大工具输出的聊天投影 | `server/tool-title.ts`、`server/host/message-pages.ts`、`server/index.ts`、`server/store.ts` | 工具标题显示上限 2048 字符，公开聊天投影不携带庞大原始字段；避免含大量图片／长命令的聊天一次传输数百万字符 |
| 可选宿主机文件挂载 | `compose.mnt.yaml` | `/mnt` 以读写方式提供给应用，使用 `rslave` 传播后续挂载；不自动提供给 Local VM 桌面 |
| 应用目录内的 CLI 更新 | `server/drivers/cli-update-command.ts`、`server/engine-install.ts`、`server/routes/instances.ts` | Claude 等 npm 安装的引擎更新应用实际使用的副本，避免更新到另一个全局 prefix |

### Full Access 与 Auto 的区别

- `full` 是用户已选择的“直接批准工具”模式，既可以由引擎执行，也可以由 harness 回答残留权限请求。
- `auto` 仍表示提供方原生的安全审核，不能因为某引擎支持 `full` 就假定它也有原生审核器。
- **从 0.1.108 起采用上游原生网页 Full Access**：普通已授权 API、浏览器、桌面都能设置；无需环境开关和二次确认。Custom 仍限桌面私有通道，托管工作区仍按其 operator policy。
- `OMB_PAIRED_WEB_FULL_ACCESS`、`pairedWebApprovals`、`/paired-full-access` 和旧确认 UI 已移除。升级时删除 `.env` 里的旧开关。不要在后续合并中把它们恢复。
- `server/web-full-access.e2e.test.ts` 验证新流程及原有身份／跨源／会话 scope 检查。Full 不取消登录，也不会批量修改每个已有 Bot 的设置。
- Bot、thread 和新 Bot 的预设各有自己的设置。修改预设不等于修改所有旧 Bot。
- **从 0.1.111 起，未设置权限的 Bot／thread 默认 Full**，主管创建的新 Bot 也使用该默认值；显式保存为 Ask／Auto／Edits／Custom 的设置继续生效，托管公司工作区按上游 operator policy。
- Full 在已授权的连接应用中发送邮件／消息时也不再弹 outbound 批准卡；应用 scope 与工具授权仍检查。可选 safety floor 默认关闭，不在此次部署中擅自开启。
- 新任务运行机制会计算主管与目标 Bot 的有效权限，并限制权限继承的来源。外部请求不应被当成人的 Full Access 授权。
- 新增引擎时，同时核对 `shared/approval-mode.ts`、驱动权限处理和 `server/runtime/capabilities.test.ts`。不能只改能力声明。

### Cursor 注意事项

Cursor 不需要在构建／启动 Docker 时预装。在“模型提供方／引擎”的 Cursor 卡片里安装、登录、检查更新。
CLI 和身份信息保存在容器的持久 HOME `/data`，更新镜像不应把它们清掉。
实例显式设置 CLI 路径时应尊重该路径；默认情况优先使用 `/data/.local` 下的安装。
详情参见 [Cursor 文档](cursor.md)，参数化模型适配见第 19 节。

Cursor 模型统一通过 ACP 配置接口设置，不再放入启动参数 `--model`；协议行为由隔离 fake CLI 测试覆盖。
两端已启用 Cursor 参数化模型接口，按所选条目分别设置原生模型、推理强度与 Fast 等参数；旧式变体替换已移除。配置接口按成功／报错处理，不增加回读核验。具体行为和验证范围见第 19 节。

## 3. 当前部署在哪里

两套安装相互独立：**数据库、Bot、聊天、引擎登录、浏览器会话和 VM 文件不能互相复制覆盖。**

| 项目 | 本机 | 50（VPS） |
| --- | --- | --- |
| 主机 | 当前开发电脑 | `108.186.129.50` |
| 源码目录 | `/home/zhipeng/codes/OpenMausBot` | `/opt/OpenMausBot` |
| 运行制品的源码 SHA | `74485aa66` | `74485aa66`，同一份编译制品 |
| 核对时应用版本 | `0.1.127` | `0.1.127` |
| 对外地址 | `https://omb.oomdev.de5.net/` | `https://ombus.oomdev.de5.net/` |
| Docker 主机端口 | `0.0.0.0:8080 → 8799` | `127.0.0.1:8080 → 8799` |
| 公网入口 | Cloudflare Tunnel | 宿主机 systemd Caddy |
| OMB 容器 | `omb`、`dind`、`cloudflared` | `omb`、`dind` |
| 运行中的 Compose | `compose.yaml` + `compose.vm.yaml` + `compose.tunnel.yaml` + `compose.mnt.yaml` + `compose.rclone.yaml` | `compose.yaml` + `compose.vm.yaml` + `compose.mnt.yaml` + `compose.rclone.yaml` |
| Caddy 容器 | 未启用 | 未启用 |
| IP 自签 HTTPS overlay | 未启用 | 未启用 |

### 本机

当前 `.env` 设置 `OMB_BIND_ADDRESS=0.0.0.0`、`OMB_HTTP_PORT=8080`、`OMB_PUBLIC_URL=https://omb.oomdev.de5.net`。
Tunnel 与应用共享网络命名空间，连接 **`http://127.0.0.1:8799`**，Cloudflare 负责公网 TLS。
Tunnel Token 位于被 Git 忽略的 `.omb-cloudflare/tunnel-token`。不需要把 Token 放进 Compose、文档或命令行。
直接 HTTP 和 Tunnel 访问同一套本机数据；不同浏览器或不同访问源会有各自的登录状态。

**本机已经使用宿主机网盘及 rclone 配置挂载，部署命令必须保留 `compose.mnt.yaml` 和 `compose.rclone.yaml`。**
Google Drive 和 OneDrive 分别由宿主机 `rclone-gdrive.service`、`rclone-onedrive.service` 挂载到 `/mnt/googledrive`、`/mnt/onedrive`；两个服务都已启用开机启动。
应用容器通过 `/mnt` 的 `rslave` 绑定读取这些目录。网盘 OAuth 配置在宿主机的 rclone 配置中，不在应用镜像内，也不应复制给 50。
本机 `.env` 设置 `OMB_RCLONE_CONFIG_DIR=/home/zhipeng/.config/rclone`；`compose.rclone.yaml` 把整个目录以读写方式挂到 `/data/.config/rclone`，供已有 `/data/.local/bin/rclone` 直接读取 `gdrive:`／`onedrive:`。配置文件不进入 Git／镜像，目录可写以保存 OAuth 刷新后的原子替换。

### 50：宿主机 Caddy

访问链路：

```text
https://ombus.oomdev.de5.net:443
  → 宿主机 Caddy
  → http://127.0.0.1:8080
  → Docker 应用监听 0.0.0.0:8799
```

50 的 `.env` **省略** `OMB_BIND_ADDRESS` 和 `OMB_HTTP_PORT`，使用基础 Compose 默认值 `127.0.0.1`、`8080`。
`OMB_PUBLIC_URL` 与 `OMB_WEBHOOK_PUBLIC_URL` 都是 `https://ombus.oomdev.de5.net`。网页 Full Access 使用上游接口，已不需要功能标志。
从 0.1.116 起，上游 Live 通话使用个人 OpenAI Key；已从两端 `.env` 和 Compose 移除 `OMB_PRO_PLAN`。
单独保存的 Live Key 优先，否则使用“API 密钥”中保存的 OpenAI Key。
应用的 `OMB_LISTEN_HOST=0.0.0.0` 是容器内部设置，不代表宿主机把 8799 或 8080 暴露到公网。

50 的 `.env` 也设置 `OMB_RCLONE_CONFIG_DIR=/home/zhipeng/.config/rclone`，通过同一份 `compose.rclone.yaml` 将该主机已有的配置目录读写挂到 `/data/.config/rclone`。使用 50 自己的配置，没有从本机复制账号。
**用户要求 50 仅挂配置目录。** 宿主机已有 rclone，但应用容器目前没有 rclone 可执行文件；本次没有安装 CLI 或改 PATH。因此容器可以读取云盘配置和两个已有挂载目录，但要运行 `rclone copy gdrive:` 等命令仍需另行提供程序。

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

### 50 的 `/mnt` 与包装命令

2026-10-12 核对发现：运行中容器的 Compose 标签包含 **`compose.mnt.yaml`**，但 `/usr/local/bin/omb-compose` 包装命令只列出了基础与 VM 两个文件。
当时部署修正包装命令，明确列出基础、VM 和 `/mnt` 三个文件，并核对更新前后的挂载完全一致。2026-10-13 又加入 `compose.rclone.yaml`，使配置目录在后续部署时保留。
维护包装命令时使它与运行栈一致；不要因执行旧包装命令而无意移除挂载。当前包装命令为：

```sh
#!/bin/sh
set -eu
cd /opt/OpenMausBot
exec docker compose -f compose.yaml -f compose.vm.yaml -f compose.mnt.yaml -f compose.rclone.yaml "$@"
```

## 4. Compose 文件的分工

| 需要的能力 | 使用的文件 | 说明 |
| --- | --- | --- |
| 纯 HTTP | `compose.yaml` | 默认映射 `127.0.0.1:8080:8799`，没有 Caddy |
| Cloudflare Tunnel | 基础 + `compose.tunnel.yaml` | Tunnel 直接访问应用，公网是 HTTPS |
| IP 自签 HTTPS | 基础 + `compose.https.yaml` | 先运行 `deploy/local/make-https-cert.sh`，启动可选 Caddy 容器；默认 HTTPS 8443 |
| Caddy 容器的域名 HTTPS | 基础 + `compose.domain.yaml` | 设置 `OMB_DOMAIN`，由可选 Caddy 容器使用 80/443 |
| 现有宿主机网关 | 基础 Compose + 宿主机配置 | 50 使用此方式，**不叠加**域名或 IP HTTPS overlay |
| 本地桌面能力 | 任一方式 + `compose.vm.yaml` | 启动专用 Docker daemon `dind`；桌面容器按需创建启动 |
| 应用访问宿主机 `/mnt` | 任一方式 + `compose.mnt.yaml` | 仅在需要时加入，两端已启用 |
| 应用读取 rclone 配置 | 任一方式 + `compose.rclone.yaml` | 挂现有配置目录到 `/data/.config/rclone`；两端启用，宿主机路径由 `.env` 指定；执行远端命令还需要 rclone 程序 |

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
- **任务权限**：运行时能力测试要体现本分支的 Full Access。从 0.1.111 起采用上游所有引擎支持 Full 的统一契约；保持外部请求不继承主管授权、Auto 仍要求原生审核器的测试，不恢复已移除的 Full 白名单。
- **验证 launcher**：新增位置参数后核对所有调用者，尤其是网页静态目录与隔离端到端测试使用的参数，避免把 boolean 当成路径。
- **路由计数 gate**：核对应用端口的 `/hooks/` 和新电脑路由中的 VM 授权；旧配对 Full Access 路由不再保留。上游移走旧路由时降低对应计数；不要删测试、放宽成任意计数。
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

涉及持久化任务机制时，再检查 runtime 协作、重启恢复、网页 Full Access 等隔离端到端测试。
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

当前使用基础 + VM + Tunnel + 宿主机 `/mnt` + rclone 配置目录。网盘 overlay 是本机现有功能，构建、更新与检查命令都应包含它：

```sh
cd /home/zhipeng/codes/OpenMausBot
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml -f compose.mnt.yaml -f compose.rclone.yaml config --quiet
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml -f compose.mnt.yaml -f compose.rclone.yaml build omb
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml -f compose.mnt.yaml -f compose.rclone.yaml up -d --no-build --remove-orphans
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml -f compose.mnt.yaml -f compose.rclone.yaml ps
curl --fail http://127.0.0.1:8080/api/health
curl --fail https://omb.oomdev.de5.net/api/health
```

`deploy/local/Dockerfile.vm` 从源码构建 UI／server，再使用现有 `openmausbot-local:latest` 运行时。
如果上游新增运行时依赖，核对编译是否把它内联、是否有原生外部依赖，以及基础镜像是否包含它们。Muse SDK 是零运行时依赖的纯 JS，可被内联；1Password SDK 需要 SDK、sdk-core 和 `core_bg.wasm`，由新版 `prepare-duckdb.mjs` 与 DuckDB 一起打包。
最近两次更新新增 DuckDB、resvg 与 1Password SDK 的原生／WASM 资源。两份本地 Dockerfile 都运行上游的 `prepare-duckdb.mjs`，把当前平台的原生资源复制到 `/app/duckdb`，并设置 `OMB_DUCKDB_DIR`。
部署时应以最终镜像的隔离启动检查为准；仅有本机 TypeScript 构建成功不足以证明镜像依赖完整。
需要刷新基础运行时时，先构建基础，再构建 VM 应用镜像：

```sh
docker build -f deploy/local/Dockerfile -t openmausbot-local:latest .
docker compose -f compose.yaml -f compose.vm.yaml -f compose.tunnel.yaml -f compose.mnt.yaml -f compose.rclone.yaml build omb
```

`--pull` 是主动更新基础镜像的选择，不应每次部署都无意切换基础版本。

### 8.2 50 服务

SSH 到 `root@108.186.129.50` 后核对 `/opt/OpenMausBot`。源码有本机已不在的临时补丁时，先核对差异，再推进到对应提交；不要强制覆盖。
如果 root 读已有工作目录触发 Git 的 dubious ownership，先确认仓库的实际归属。对已确认目录可使用单次 `git -c safe.directory=/opt/OpenMausBot ...`；不要把所有路径都设为可信。

50 的源码仓库是浅克隆。增量 Git bundle 的前置提交不一定都在远端；先运行 `git bundle verify`，若提示缺少 prerequisite，改为从本机创建包含目标分支完整可达历史的 bundle，再校验、fetch 和快进。此次 0.1.111 已按此处理；不要用 reset 覆盖远端工作区，也不要把制品校验成功误认为 Git 同步已经成功。

50 当前实际栈包含 `/mnt` 和 rclone 配置目录，使用完整命令：

```sh
cd /opt/OpenMausBot
docker compose -f compose.yaml -f compose.vm.yaml -f compose.mnt.yaml -f compose.rclone.yaml config --quiet
docker compose -f compose.yaml -f compose.vm.yaml -f compose.mnt.yaml -f compose.rclone.yaml build omb
docker compose -f compose.yaml -f compose.vm.yaml -f compose.mnt.yaml -f compose.rclone.yaml up -d --no-build --remove-orphans
docker compose -f compose.yaml -f compose.vm.yaml -f compose.mnt.yaml -f compose.rclone.yaml ps
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
- 两端保留 `/mnt` 和 `/data/.config/rclone`，以应用的 UID 1000 核对配置可读／目录可写、两个网盘目录实际可读。本机有 CLI 时再执行 `rclone listremotes`；50 当前仅核对配置段名，不把配置挂载写成 CLI 已安装。仅有宿主机 rclone active 不足以证明容器能访问网盘。
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
源码同步阶段没有发布该临时验证镜像。随后按用户的部署请求完成了经过核对的制品发布，具体方法和实际运行状态见第 11 节。

原始日志存放在本机被 Git 忽略的 `.omb-scratch/upstream-sync-20261012/`，包括 `targeted.log`、`workflows.log`、`acp-probes.log`、`stream-ui.log`、`packaged.log` 与 `native-check.json`。
隔离 foreground fixture、流式测试拥有的服务器／浏览器和临时运行容器已经清理。SSH 临时凭据已经删除。
上述源码同步检查结束时，两端仍运行 0.1.101；后续部署及包装命令修正已完成，见下节。

## 11. 两端部署完成记录（2026-10-12）

用户随后要求部署，此次把本机与 50 都更新到了 **0.1.107**。没有改变入口方式，没有启用 Caddy 容器。

| 项目 | 本机 | 50 |
| --- | --- | --- |
| 镜像内源码提交 | `22f85d1acff2645ea59292debcb0ef33696de599` | 同左 |
| 实际应用镜像 ID | `sha256:77341dc7122b39ea3214fff30b11595a1f808bc57d36132d71d0b8f760802ffb` | `sha256:adff5a9e7264a534ffdb63c7477302bf5653e10edaa0e2b14e1395d5f14075e4` |
| 运行标签 | `openmausbot-vm:local` | `openmausbot-vm:local` |
| 发布标签 | `openmausbot-vm:0.1.107-22f85d1ac` | 同左，指向各自当前镜像 |
| Compose | 基础 + VM + Tunnel | 基础 + VM + `/mnt` |
| HTTP 映射 | `0.0.0.0:8080 → 8799` | `127.0.0.1:8080 → 8799`，使用默认值 |
| 公网入口 | `https://omb.oomdev.de5.net/` | `https://ombus.oomdev.de5.net/` |
| 健康与重启次数 | healthy，`RestartCount=0` | healthy，`RestartCount=0` |
| VM daemon | 29.8.1，应用能够连接专用 socket | 同左 |

### 发布方法与制品核对

为避开多阶段构建重复下载依赖的网络问题，本次使用**已安装的锁定依赖在本机编译，再在两台机器分别组装运行时镜像**。
这仍使用现有 Compose 和同一个应用运行标签，只改变镜像的生成过程。

1. 工作区干净，固定源码 SHA `22f85d1ac`，重新运行 `pnpm build:server`、`pnpm exec vite build`、`pnpm build:duckdb`，三项均通过。
2. 两端基础镜像都是 `openmausbot-local:latest`，完整 ID 为 `sha256:6474542e76e44ef73280a82dbd61600e5c243905beeb60c896710d3890a790c2`；平台都是 Linux amd64。
3. 发布目录仅包含 `dist-server/`、`dist/`、`dist-native/duckdb/linux-x64/`（在制品中命名为 `duckdb/`）及 `package.json`，另外添加发布清单和校验文件。没有复制 `.env`、用户数据、引擎登录或 Tunnel Token。
4. 运行时镜像从该基础镜像构建，设置 `OMB_DUCKDB_DIR=/app/duckdb`，把上述文件复制到 `/app`，使用 `maus:maus` 所有者，入口仍是 `node dist-server/server-launcher.js`。
5. `/app/deployment-manifest.json` 记录完整源码 SHA、上游 SHA、基础镜像 ID、构建时间、平台和每个制品文件的 SHA-256。镜像的 `org.opencontainers.image.revision`／`version` 与该清单一致。
6. 1106 个应用制品文件在两端最终镜像内全部校验通过；同一份清单的聚合校验值为 `da7c13b059e1571807f34c3e8a73f746cedca75bb5f20ed068ae4936a61fbea7`。实际镜像 ID 因分别构建而不同，文件内容相同。
7. 两端均用不挂载用户数据、`--network none` 的一次性容器执行真实 DuckDB 内存 SQL 查询和 resvg PNG 渲染；另在本机使用临时 HOME／数据目录启动最终镜像，验证健康接口和完整网页，随后清理隔离容器。

以后使用制品发布时，继续按上述顺序核对完整文件树与原生依赖。可以读取运行中的版本／提交作对照：

```sh
docker exec openmausbot-omb-1 node -p "require('/app/package.json').version"
docker exec openmausbot-omb-1 node -p "require('/app/deployment-manifest.json').sourceRevision"
docker inspect openmausbot-omb-1 --format '{{.Image}} {{.State.Health.Status}} {{.RestartCount}}'
```

### 切换、清理与验证范围

50 的源码用包含完整新增历史的 Git bundle 快进到同一分支，未依赖尚未推送的 GitHub 提交；维护文档的随后提交也同步到 50。
两端都使用现有完整 Compose 组合执行 `up -d --no-build --pull never --remove-orphans --timeout 60 --wait --wait-timeout 180`，通过 Docker 的正常停止流程更新。
共享应用网络的 `dind`／`cloudflared` 一起重新创建，核对其网络命名空间已指向新应用容器，避免还连着旧容器。

更新前后的持久卷、端口、UID/GID 与挂载保持一致。50 的 `/mnt` 保留 `rslave`，包装命令已包含该 overlay。
宿主机 Caddy 仍是 active／enabled，完整配置文件哈希未变，因此既有 OMB 与 Orca 路由都保持原样。

本机与 50 的 loopback 和公网 `/api/health` 均返回成功；四个入口返回的网页与本次构建的 `dist/index.html` 校验值相同。
未登录的公网健康接口只返回应用名称，这是服务器的正常访问控制，不应要求它提供 loopback 才有的 PID 和能力字段。
本机检查时使用 `curl`；当前开发环境的 Python urllib 公网请求会出现 403，不能把这种客户端差异当成服务升级失败。

50 已删除被替换的旧应用镜像，并清理此次上传的 Git bundle、构建归档、校验脚本和临时构建目录；没有制作数据备份。
本机保留旧镜像标签 `openmausbot-vm:before-upstream-0.1.107-20261012`，仅供本机恢复时使用。
没有发送邮箱验证码、生成配对码或调用真实付费引擎。此次确认的是部署、构建制品、健康、网页版本、VM daemon 和持久挂载，未重新验证实际账号的登录流程。

本机证据在 `.omb-scratch/deploy-20261012/`，其中 `local-receipt.json` 与 `50-receipt.json` 记录端口、镜像、来源和挂载检查结果。
50 另保留不含凭据和用户内容的 `.omb-scratch/deployment-receipt.json` 运维记录。上述运维记录不是数据备份。

## 12. 再次同步与网盘恢复（2026-10-12 至 2026-10-13）

此次上游目标固定为 `295f947dac548af954d0f792b8631269bb423fd0`，纳入 33 个提交，合并提交为 `5316184f8e6e653cecd43130f20134eb33a3ab67`。
包版本仍是 0.1.107。功能变化是支持的引擎之间切换时保留 Full Access、隐藏 Thread 列表时返回主聊天、Live 通话记录和通话资格检查。

### 合并与验证

唯一文本冲突在 `ChatView.tsx`。保留本分支的临时流式消息，同时使用上游的 `lastNonReceipt`，让通话记录不会掩盖仍在工作的真实消息。
本分支的引擎 Full Access 支持范围、Cursor 安装／用量与经过认证的查看器等定制保留。
补充了 Codex → Cursor、Cursor → Antigravity 的权限保留断言。

上游一条 Store 测试仍要求跟随 Bot 的线程在引擎切换后降为 Ask；根据新的契约修正为保留 Full，并保留旧字段状态、重载、独立模型和写入失败回滚的断言。
该文件的 143 项检查重新全部通过，没有恢复旧的降级行为来迎合过时断言。

| 检查 | 结果 |
| --- | --- |
| 单元／渲染器／路由检查 | 35 个文件，最终 1040 项通过；失败的 Store 文件修正后单独重跑 |
| Live 与聊天重启恢复 | 2 个隔离端到端文件，19 项通过，其中重启恢复的一项也在上一组执行 |
| 浏览器流式显示 | 1 项通过，保留暂停 rAF 时的缓冲完整性和最终去重 |
| Electron 套餐传递 | 34 项通过 |
| 静态与构建检查 | typecheck、lint、4073 条英文源字符串的翻译检查、163 个 Electron 模块语法检查、server／UI／原生资源构建和 packaged server smoke 通过 |
| Compose 配置 | 两端现有组合解析通过，`OMB_PRO_PLAN` 的 0／1 均能传入容器 |
| 最终镜像 | 两端校验 1108 个制品文件，DuckDB 内存 SQL 与 resvg PNG 渲染通过；本机临时数据的最终镜像启动和网页检查通过 |

没有运行真实付费引擎、OpenAI 语音服务或邮箱登录验证。Live 的检查使用模拟提供方与独立数据目录。

### 中断与实际发布

2026-10-12 中断时，代码合并、本机镜像构建和 50 源码快进已经完成，**应用容器尚未切换**。
2026-10-13 恢复工作后重新核对运行镜像、挂载、源码和归档；两端旧容器仍运行 `22f85d1ac` 的制品。
随后完成当次两端更新，当次镜像来源均为 `5316184f8`，运行标签仍是 `openmausbot-vm:local`，发布标签为 `openmausbot-vm:0.1.107-5316184f8`。

| 项目 | 本机 | 50 |
| --- | --- | --- |
| 实际镜像 ID | `sha256:07b088efd4a871c6c2c9fc018a69c63295752c44f78d28925934345425427a63` | `sha256:79f9f244f4bbd8ec54f1fbecfdf9d8894350342d992176ffb80f617f6b4e70e9` |
| Compose | 基础 + VM + Tunnel + `/mnt` | 基础 + VM + `/mnt` |
| Live 资格配置 | `.env` 和运行容器均为 `OMB_PRO_PLAN=1` | 同左 |
| 健康 | healthy，RestartCount 0 | healthy，RestartCount 0 |

制品聚合 SHA-256 是 `3370828c4c0da1587717809baf638e9a529585b3b45eebce278714c9df187e7f`。
普通文字聊天不依赖 Live 套餐配置；Live 仍需应用里配置的 OpenAI Key。没有把用户引擎或网盘凭据装入镜像。

### 本机网盘丢失的原因与修复

之前的本机发布命令遗漏了 `compose.mnt.yaml`。因此宿主机 rclone 服务一直健康，但应用容器没有 `/mnt` 绑定，看不到 Google Drive／OneDrive。
这是容器挂载配置遗漏，不是网盘重新授权的问题；昨天中断前的这次新镜像尚未发布，也没有触发网盘卸载。

已将 `compose.mnt.yaml` 加入本机实际部署组合，保留原数据卷和端口，新增 `/mnt` 的读写 `rslave` 绑定。
在应用 UID 1000 下实际打开 `/mnt/googledrive` 和 `/mnt/onedrive`，两个目录都能读取条目，容器的 mountinfo 也确认是 `fuse.rclone`。
宿主机两个 rclone 服务继续 active／enabled，无需重新登录。第 3、8 节与通用部署 README 已明确要求后续更新保留这个 overlay。

50 保持原有 `/mnt`、loopback 8080 和宿主机 Caddy；Caddy 完整配置哈希未变。
两端的 loopback 和域名健康接口、网页制品校验及专用 VM daemon 连接通过。
50 清理了旧应用镜像、本次上传归档、Git bundle 与临时构建目录，没有备份用户数据；本机保留 `openmausbot-vm:before-live-20261012` 供恢复。

这轮记录在 `.omb-scratch/upstream-sync-20261012-live/`：`units.log`（原始失败）、`store-final.log`（修正后通过）、`live-e2e.log`、`stream-ui.log`、`local-receipt.json` 和 `50-receipt.json`。

## 13. 0.1.108 同步与 Full Access 简化（2026-10-13）

### 合并决策

- 网页 Full Access 改用上游普通 PATCH 路由：Bot 设置应用到全部 thread，composer 只改当前 thread；新 Bot 预设也走普通创建流程。
- 删除配对管理员专用接口／桥接、环境开关、重复确认流程。配对与邮箱身份系统、会话管理、Custom 私有桌面保护继续使用上游实现。
- 保留 Kimi、Droid、Hermes、Pi、Custom ACP 的 Full capability 和 native mode 映射；同时纳入上游 Meta／Muse 能力。Auto 仍是 native reviewer，不能把额外引擎的 Full 当成安全自动审核。
- 保留网页文本／reasoning 流式订阅、后台/rAF 尾部与最终去重。保留 Cursor 安装、浏览器登录、原生更新和实例 HOME 下实际 CLI 的版本探测。
- 迁移 fork 的 VM 地址／授权到 `server/routes/computers.ts`，Cursor 原生更新互斥及应用 npm prefix 到 `server/routes/instances.ts`，长工具输出投影到 `server/routes/bots-create.ts`。套餐用量由上游新 `status.ts` 路由调用 fork 的 fetch/cache 实现。
- 本机部署仍必须保留 `/mnt` overlay，50 仍保持 loopback 8080 和宿主机 Caddy。两端数据各自独立。

上游本次新增源文件行数 gate，首次接入时按 fork 已有流式、Cursor 用量、长输出和 Docker／viewer 定制初始化精确基线，并纳入原有 `plan-usage.ts`。检查的逻辑和 2000 行新增文件上限未放宽，后续修改必须拆分或降低基线。`index.ts` 的旧 route 块按上游移除，未恢复旧的巨型处理器。

### 隔离验证

证据目录：`.omb-scratch/upstream-sync-20261013-full/`。

| 检查 | 结果 |
| --- | --- |
| 核心权限／驱动／Store／流式／Cursor 用量 | 32 文件共 995 项；首次 3 项失败，修正对应 3 文件后 22 项全通过，其余 29 文件已通过 |
| 原生资源、ACP、Meta／Muse、viewer 路由 | 6 文件，215 项通过；4 项平台条件跳过 |
| 独立线程、任务 roots/paths、房间协作、重启队列、新 Bot 预设 | 6 文件，75 项通过；2 项条件跳过 |
| Full 配置工具工作流与新网页 Full／Custom 边界 | Full 工作流 1 项通过；网页 4 项通过，包含 cookie、bearer、单线程、全部线程、返回 Ask 和 Custom 拒绝 |
| 完整 HTTP 路由回归 | 首次 294/295 通过；队列事件的异步落盘断言改为 `expect.poll` 后对应场景通过 |
| 真实浏览器流式 | 1 项通过，暂停 rAF 后文本/reasoning 完整，完成时无重复 |
| 静态检查 | Node 24 typecheck、lint、4256 条英文源字符串的翻译检查、163 个 Electron 模块语法检查通过 |
| 构建与 packaged smoke | 清空生成目录后重新 build server；UI 与原生资源构建通过；仓库/node_modules 外独立启动、13 个 proxy 路径、MCP、worker、launcher 通过 |
| Compose | 本机基础+VM+Tunnel+mnt、域名 HTTPS、IP HTTPS 配置解析通过 |

修正的测试包括：旧 Full 文案改为上游文案；Cursor 过期测试在真实 CLI 发出链接后触发过期回调，清理仍使用真实进程计时器；新网页测试使用真实支持 Custom 的 fake Codex 检查私有通道，且按现有权限解析器断言未配对请求的 403。
首次尝试用 `node --test` 跑 Vitest 文件，以及整体 fake timers 的过期测试均不是通过证据；已改用正确 runner 和范围明确的计时器回调。

未运行完整跨平台 `pnpm test`、真实付费引擎、真实邮箱验证码或真实 1Password 账号。所有创建 Bot、改权限、发送消息和重启恢复场景均使用隔离 HOME／数据目录。

### 本机与 50 发布结果

两端在 2026-10-13 已切换到源码 `d7fe6688204be1aba364c57576f835505db14494`，运行标签仍为 `openmausbot-vm:local`，发布标签为 `openmausbot-vm:0.1.108-d7fe66882`。
源码合并提交已通过 pre-push 的 lint/typecheck/i18n 检查并推送；50 通过 Git bundle 快进到同一分支，部署说明另作一次文档提交。

| 项目 | 本机 | 50 |
| --- | --- | --- |
| 版本 | `0.1.108` | `0.1.108` |
| 镜像 ID | `sha256:75de7371e8ecc2c745b056f3d4cc8fbd670f9391a71156a4cf0cf1e10238da92` | `sha256:d3b5b239f06f7dc1cccb876d473c82f83c8235438ba4fad781b2726127cb3943` |
| 服务 | omb + dind + cloudflared | omb + dind |
| Compose | 基础 + VM + Tunnel + `/mnt` | 基础 + VM + `/mnt` |
| 宿主机映射 | `0.0.0.0:8080 → 8799` | `127.0.0.1:8080 → 8799` |
| 公网健康／网页制品 | `https://omb.oomdev.de5.net` 通过 | `https://ombus.oomdev.de5.net` 通过 |
| 容器状态 | healthy，RestartCount 0 | healthy，RestartCount 0 |
| VM daemon | `29.8.1`，共享新应用网络命名空间 | 同左 |

此轮继续使用经过验证的编译制品覆盖现有基础运行时的方式构建 Docker 镜像，没有重新从网络安装基础引擎。
构建上下文来自清空生成目录后的 server/UI 构建和新版 `prepare-duckdb.mjs`，运行镜像清除旧的 `/app/dist-server`、`/app/dist`、`/app/duckdb` 后再复制当前制品。Canonical 多阶段 Dockerfile 的全新网络构建不列为此轮通过项目。
两端核对 **1169 个制品文件**，聚合 SHA-256 为 `6c297101e8b97e569327b3119cadf044baeb94cc421fa749d7835d0b7c36e4a3`。
DuckDB 内存 SQL、resvg PNG、1Password SDK 加载和 WASM 验证均通过；最终镜像以临时 HOME、无网络和不挂载生产数据的方式启动检查通过。
两端公网与 loopback 的首页哈希均为 `501aaf2568b433c15f1dc507f4307cf1e02bc7746fc43496bb17ab010e31a88e`。

本机 Google Drive／OneDrive 目录以应用 UID 1000 实际打开可读，两个宿主机 rclone 服务继续 active/enabled，`/mnt` 的 RW/rslave 绑定和原有数据卷均保留。
50 的 `/mnt`、默认 loopback 8080、宿主机 Caddy 与 Orca 站点配置保持不变；Caddy 配置哈希为 `7cc1951ff095404a5001850a9977a9ffe5d36bc45fa42f5b4abbe446e0e1e7b9`。
两端移除 `.env` 中旧的 `OMB_PAIRED_WEB_FULL_ACCESS`，仍保留 `OMB_PRO_PLAN=1`。Full Access 选项现在直接走上游认证 API。

按现有偏好，50 未备份用户数据、未保留旧应用镜像；上传的归档、bundle、校验脚本和临时构建目录在交接结束时删除。本机保留 `openmausbot-vm:before-full-20261013` 供恢复。
没有执行邮箱登录或生成生产配对码。两端持久 HOME、登录资料和工作数据没有相互复制。

证据包括本机 `local-receipt.json`、50 的 `50-receipt.json`、`native-and-artifacts.json`、`image-smoke.json`、`push.log` 和各检查日志，存放在本节开头的忽略目录。

### 发布后本机健康探测的短暂超时

最终巡检曾看到本机 Docker 健康状态变为 unhealthy。随后同一应用进程和同一容器自行恢复；没有再次重启服务，没有修改 4 秒请求超时，也没有放宽健康判定。
抓到的探测记录在 09:56:55—09:57:37 UTC 连续超过约 4 秒并失败，09:57:52 UTC 起恢复成功（北京时间分别为 17:56—17:57）。容器 `StartedAt` 一直是 `2026-10-13T09:49:36.151417146Z`，应用 PID 15、宿主机 PID 3750761 未变，RestartCount 仍为 0。

当前日志只包含正常启动信息，没有给出这段延迟的原因；不能把它归因于 Bot 发信号，也不能宣称已修复一个确定的性能问题。后续健康观测记录在 `final-health-observation.json`，正常 loopback／公网接口与网页制品另有发布回执。50 的最终检查一直为 healthy。

## 14. 本机 rclone 配置目录挂载（2026-10-13）

按用户要求，此次只新增配置目录挂载。使用 `compose.rclone.yaml` 与 `.env` 中的 `OMB_RCLONE_CONFIG_DIR`，目标是应用默认 HOME 下的 `/data/.config/rclone`。现有 rclone 位于 `/data/.local/bin/rclone`，没有安装或更新 CLI，也没有调整 PATH。

Compose 更新必须包含基础 + VM + Tunnel + mnt + rclone。原有 `/mnt` 的 RW/rslave、数据卷、宿主机 8080、Tunnel 与专用 VM daemon 保留。当时 50 继续使用其原有组合和独立账号；随后加入配置目录挂载，见第 15 节。

验证使用合成配置的隔离容器，以及运行容器中只读的配置段名与 `rclone listremotes`；不在真实云盘复制、同步或删除文件。已用当前应用镜像与合成配置，在无网络的隔离容器中以 UID 1000 验证默认路径发现和配置原子替换；合成目录不含真实账号信息。
应用容器已通过完整 Compose 组合重新创建，镜像不变，原有数据卷、挂载、端口和两个依赖服务的共享网络保持一致。
实际运行容器的配置目录可读且可写，`rclone config paths` 指向 `/data/.config/rclone/rclone.conf`，`/data/.local/bin/rclone listremotes` 列出 `gdrive:` 和 `onedrive:`；本机 loopback 与公网健康接口通过，RestartCount 0。
只列举配置中的远端名，没有发起真实云盘文件复制／同步／删除，也没有重新登录云盘。证据在 `.omb-scratch/rclone-config-20261013/receipt.json` 与 `fixture.log`。

## 15. 50 的 rclone 配置目录挂载（2026-10-13）

检查发现 50 的宿主机已有 `/home/zhipeng/.config/rclone/rclone.conf`，包含 `gdrive`、`onedrive`；配置目录归 UID/GID 1000，目录权限 700、文件权限 600。两个宿主机云盘服务及 `/mnt/googledrive`、`/mnt/onedrive` 正常，应用容器之前没有配置目录，也没有 rclone 程序。

用户选择“仍然只挂配置目录”。已将源码快进到 `149c14858`，设置该主机的 `OMB_RCLONE_CONFIG_DIR`，并在 `/usr/local/bin/omb-compose` 中加入 `compose.rclone.yaml`。使用基础 + VM + mnt + rclone 四份配置执行 `up -d --no-build --pull never --remove-orphans --timeout 60 --wait --wait-timeout 180`，应用与 dind 已正常重建。

新增绑定为 `/home/zhipeng/.config/rclone → /data/.config/rclone`，读写；在应用 UID 1000 下确认目录和配置可读写、配置段名正确、两个网盘目录可读取。未安装 rclone，未修改 PATH，未复制本机云盘账号，未对真实云盘文件执行写入／同步／删除操作。

应用仍运行 0.1.108，镜像 ID 保持 `sha256:d3b5b239f06f7dc1cccb876d473c82f83c8235438ba4fad781b2726127cb3943`。原有数据卷、`/mnt` 的 RW/rslave、loopback 8080、VM socket 均保持一致。应用 healthy，RestartCount 0，dind 连接新应用网络命名空间；本机接口及 `https://ombus.oomdev.de5.net/api/health` 通过。

宿主机 Caddy 配置哈希保持不变，Caddy 与三个 rclone 服务均 active/enabled。未备份用户数据、未创建或保留额外应用镜像；临时 Git bundle 已清理。
只读核对结果存放在本机 `.omb-scratch/rclone-config-50-20261013/verify.log`，以及 50 的 `.omb-scratch/rclone-config-50-20261013-receipt.json`；这些文件仅记录部署状态，不含凭据或用户文件内容。


## 16. 0.1.111 同步（2026-10-15）

### 合并与兼容

上游固定为 `c2cf30127c9fb6fb506be533f361214f764c01da`，从 0.1.108 基线纳入 583 个提交；共处理 27 个文件的文本冲突。

- Full Access 采用上游默认和全引擎能力，不再维护额外引擎列表；保留 fork 的权限回归测试。新默认不覆盖已有显式 Ask，也不会取消登录、scope 和真实问题卡。
- 流式文本和 reasoning 的 thread 独立订阅、后台 rAF 排空、完成清理继续保留；临时流式气泡接入上游新增的聊天宽度和 `@you` 显示。
- Cursor 浏览器登录、按需安装、原生更新和检测保留；适配上游统一账号卡片与安静更新按钮。共享 CLI 的更新互斥使用同一份繁忙任务检查。
- 公开聊天投影移到上游新抽出的 `server/host/message-pages.ts`，避免分页／SSE 重新带上大工具字段。工具桥接后的标题仍执行脱敏和 2048 字符上限；运行时事件继续移除精确命令与原始大字段。
- VM 访问地址、查看器认证、单端口 webhook 保留；测试随上游改用 `OMB_BOAT_API`。Codex 新并发、退出等待与登录恢复逻辑保留，同时继续使用 fork 的实际 CLI 更新命令。
- 源文件行数基线按合并后的较小文件重新计量，没有提高原 fork 的任何大文件上限。路由基线采用上游拆分后的数量，仅保留应用端口 `/hooks/` 的额外 startsWith。
- 基础 Compose 纳入上游浏览器要求的 `shm_size: 512m`，继续使用 `init: true`。本机基础+VM+Tunnel+mnt+rclone、50 基础+VM+mnt+rclone，端口与网关保持现有约定。
- Antigravity 继续采用谷歌官方 ACP 的接口和模型列表，不切换个人账号端点、不修改官方模型筛选。

### 验证与发布

证据目录为 `.omb-scratch/upstream-sync-20261015/`。

| 检查 | 结果 |
| --- | --- |
| 核心驱动、权限、Cursor 安装登录更新、套餐用量、流式、viewer、代码规模／路由 gate | 20 文件，247 项通过 |
| HTTP、Store、Full 默认、网页会话／权限边界、Codex、Group VM、引擎／Markdown／用量组件 | 15 文件；首次 889 通过、2 条件跳过、1 旧假设失败；显式设定 Ask 基线后重跑网页 4 项通过 |
| 修正与投影回归 | 4 文件，9 项通过；包括新抽出的分页／SSE helper 限制旧长标题并移除 screen pixels，不修改原始历史 |
| 浏览器流式 | 1 项通过；暂停 rAF 时 text/reasoning 完整，最终回复无重复，console 无 error |
| 静态检查 | Node 24 typecheck、lint、4457 条英文源字符串的翻译检查通过；165 个 Electron 模块语法通过 |
| 构建 | 清空 server/UI 输出后重新构建，通过；Linux x64 DuckDB、resvg、1Password 原生／WASM 资源准备通过 |
| 独立 packaged smoke | 仓库与 node_modules 外启动、13 个 proxy、MCP、headless doctor/bots、隔离加密导出 worker、launcher、桌面 compile cache 与 enterprise 发现通过 |
| Compose | 本机完整组合、50 组合、域名 HTTPS、IP HTTPS 配置解析通过 |

网页测试现在在测试单线程设置前显式把 fixture 的 Bot 与所有 thread 设为 Ask，避免前面场景已写入的 Full 影响断言；产品仍使用上游默认值，没有修改生产用户的权限来让测试通过。

没有运行完整跨平台测试集、真实付费引擎或真实邮箱验证码。创建 Bot、改权限、发消息、导出和浏览器操作均只在隔离 HOME／数据目录进行。
源码合并提交 `b847b3ff0` 已通过 pre-push 的 lint/typecheck/i18n 检查并推送到 `origin/feature/zpmodified`；下面记录已完成的发布。


### 两端发布结果

2026-10-15（北京时间）两端已切换到同一份 0.1.111 编译制品，发布标签为 `openmausbot-vm:0.1.111-b847b3ff0`，运行标签仍为 `openmausbot-vm:local`。

| 项目 | 本机 | 50 |
| --- | --- | --- |
| 镜像内源码 SHA | `b847b3ff0150b7a89823bf6b046a7f519cbe1b56` | 同左 |
| 实际镜像 ID | `sha256:98261f05931ba01ca0fec564b8ac8c80ce103ba2448247e021fda51860e7275b` | `sha256:ba8e9bad333ea3c0ca7cb914729f1e10bf1e45ac6bbf08b8e64fa6a2de62c8bc` |
| 服务 | omb + dind + cloudflared | omb + dind |
| Compose | 基础 + VM + Tunnel + mnt + rclone | 基础 + VM + mnt + rclone |
| 映射 | `0.0.0.0:8080 → 8799` | `127.0.0.1:8080 → 8799` |
| 公网入口 | `https://omb.oomdev.de5.net`，健康／首页校验通过 | `https://ombus.oomdev.de5.net`，健康／首页校验通过 |
| 状态 | healthy，RestartCount 0 | healthy，RestartCount 0 |
| HOME／用户／共享内存 | `/data`，`1000:1000`，512 MiB | 同左 |
| 专用 VM daemon | 29.8.1，连接新应用网络命名空间 | 同左 |

- 两端继续采用第 11 节的制品覆盖基础运行时方法，没有从网络重新安装基础引擎。制品由本机当前锁定依赖重新编译；两台基础镜像均为 `sha256:6474542e76e44ef73280a82dbd61600e5c243905beeb60c896710d3890a790c2`，平台均为 Linux amd64。
- `/app/package.json` 两端均为 0.1.111；`/app/deployment-manifest.json` 记录完整 fork 源码 SHA、上游 SHA、构建时间和逐文件哈希。**1278 个应用制品文件**在两台最终镜像中全部核对通过，聚合 SHA-256 为 `ccc0a1d98c0b9670ab782e6863198e035f70ee6d9e5add344f13677e7afcee3a`。
- 两台最终镜像在无网络的一次性容器中通过 DuckDB 内存 SQL、resvg PNG、1Password SDK 加载及 WASM 校验。本机最终镜像还用临时 HOME、不挂生产数据独立启动，健康和网页通过。
- 本机 loopback／Tunnel、50 loopback／宿主机 Caddy 四个入口的首页 SHA-256 都是 `8ec8c763311ac6f2a3f98519ca00ee5d25bf52f6f4e234e7c4b220013a7b7e66`。本机 Tunnel 重新建立连接前曾出现一次短暂连接失败，随后在同次检查中恢复并通过，没有再次重启应用。
- 两端更新前后数据卷、VM socket、端口、UID/GID、`/mnt` RW/rslave 与 rclone 目录 RW 绑定一致。以应用 UID 1000 打开 Google Drive／OneDrive 目录可读，rclone 配置可读写且包含 gdrive/onedrive；本机现有 CLI 的 `listremotes` 通过，50 仍只挂配置、未安装 rclone 程序。
- 50 的宿主机 Caddy active/enabled，完整配置哈希 `7cc1951ff095404a5001850a9977a9ffe5d36bc45fa42f5b4abbe446e0e1e7b9` 未变，OMB 与 Orca 既有路由保留，没有运行 Caddy 容器。
- 50 先完成镜像和制品校验，再通过完整源码 bundle 快进浅克隆仓库，最后用现有 `/usr/local/bin/omb-compose` 切换。增量 bundle 因缺少历史提交而拒绝，没有以失败的校验结果继续切换。
- 50 已删除被替换的旧应用镜像、此次上传的构建归档、两个源码 bundle、校验脚本和临时构建目录；没有制作用户数据备份。本机保留 `openmausbot-vm:before-sync-20261015` 用于恢复。
- 两端没有互相复制用户数据或账号，没有发送邮箱验证码、生成生产配对码或执行真实付费引擎请求。最终部署记录只证明本节列出的健康、制品、入口、挂载及 VM 连接。

主要证据是 `local-receipt.json`、`50-receipt.json`、`native-and-artifacts.json`、`image-smoke.json`、`packaged.log`、`stream-ui.log`、`push.log` 和各部署日志，位于本节开头的忽略目录。50 仅保留不含凭据或用户内容的 `.omb-scratch/deployment-receipt.json` 运维回执。

## 17. 新增 ChatGPT 账号时选择认证类型

本节对应源码提交 `db97b82937a94f66e3cf2edc7aee86bf74741cf2`，已部署到本机和 50。功能及部署检查分别记录如下。

上游已支持 ChatGPT plan 多账号和 Codex 设备码登录；本次接通的是“添加另一个 ChatGPT 账号”表单中的类型选择。

| 表单文案 | 保存的 `config.authMode` | 认证与运行 |
| --- | --- | --- |
| Codex 设备码登录 | `device-code` | 默认选项；复用原生 Codex 设备码组件，可通过远程管理页面启动登录；模型与套餐用量按 Codex 账号读取 |
| ChatGPT plan | `chatgpt-plan` | 保留上游浏览器 PKCE／计划令牌流程；代理／非 loopback 请求不能启动此浏览器授权，托管登录仍需 OpenAI 批准 |

- `POST /api/instances/chatgpt-accounts` 现在要求显式提交 `displayName` 和 `authMode`。缺失或未知类型、额外的环境注入字段返回 400，不自动尝试另一种认证。
- 新设备码账号沿用 `chatgpt-<UUID>` 实例 ID，继续使用既有账号列表、模型选择、重命名、退出和删除流程。每个账号的 `CODEX_HOME` 位于 `<DATA_DIR>/providers/codex/<sha256(instanceId)>/codex`，创建实例时即建立目录。
- ChatGPT plan 的既有目录 `<DATA_DIR>/providers/chatgpt-plan/<sha256(instanceId)>` 保持原位置。没有设置 `authMode` 的原生 Codex 实例仍使用原配置。
- `server/drivers/codex-account.ts` 统一提供显式账号的目录，驱动的登录／模型／对话／退出与套餐用量读取使用同一目录。某账号缺少凭据时，不读取默认 Codex 账号来替代。
- 这些目录位于已有备份排除的 `providers/` 中；不上传、迁移或互相复制真实凭据。独立账号目录不会扩大 Codex 或 ChatGPT plan 的模型授权范围。
- 配置解码与套餐账号列表构造分别抽出到 `codex-config.ts`、`plan-usage-accounts.ts`，大文件行数上限只下调。

验证方法见 [引擎认证检查](verification/engines.md#chatgpt-account-sign-in-types)。功能测试仅使用临时服务和模拟 CLI，不证明真实 OpenAI 授权或账号模型访问。

### 两端部署结果（2026-10-15）

账号表单仅保留“Codex 设备码登录”和“ChatGPT plan”两个选项；按用户要求移除了 `accounts.chatgptPlanLocalHint` 的界面、翻译与源哈希条目。
源码提交已推送至 `origin/feature/zpmodified`。本次没有合并更多上游提交，纳入的上游仍为 `c2cf30127c9fb6fb506be533f361214f764c01da`。

| 项目 | 本机 | 50 |
| --- | --- | --- |
| 应用版本／制品源码 | 0.1.111／`db97b8293` | 同左 |
| 实际镜像 ID | `sha256:576aaf0d5c96089eb2866ee2c8b181be93c0c9ac09e83d2905871d743d7579de` | `sha256:2c30623f38ba8afab4a4b8a91ab1c67a390ca5d2563389e5d537b2290d68a60b` |
| 发布标签 | `openmausbot-vm:0.1.111-db97b8293` | 同左 |
| Compose | 基础 + VM + Tunnel + mnt + rclone | 基础 + VM + mnt + rclone |
| HTTP 映射 | `0.0.0.0:8080 → 8799` | `127.0.0.1:8080 → 8799` |
| 公网入口 | `https://omb.oomdev.de5.net` | `https://ombus.oomdev.de5.net` |
| 状态 | healthy，RestartCount 0 | healthy，RestartCount 0 |

- 删除提示后重新运行账号表单、隔离账号 API、套餐用量与大文件 gate：4 个文件、27 项通过。推送前 lint、typecheck、10 个语言包的翻译检查通过，英文源字符串为 4460 条。
- 清空输出后重新构建 server/UI，并重新准备锁定版本的原生资源。独立 packaged smoke 在仓库与 node_modules 外验证启动、13 个代理入口、MCP、headless CLI、隔离导出 worker、launcher、compile cache 和 enterprise 模块发现。
- 发布继续采用第 11 节的运行时制品覆盖方法。两端基础镜像仍为 `sha256:6474542e76e44ef73280a82dbd61600e5c243905beeb60c896710d3890a790c2`。`/app/package.json` 均为 0.1.111，`deployment-manifest.json` 记录本次完整源码 SHA、上游 SHA、构建时间与每个应用制品文件的哈希。
- 同一份 **1282 个应用制品文件**在两端最终镜像中全部校验通过，聚合 SHA-256 为 `1ee88b8da38229015127bfc6c98653eb2fed14ff5c495fd16f640e08963fb76d`。两端的一次性无网络容器通过 DuckDB SQL、resvg PNG、1Password SDK 加载与 WASM 校验；本机最终镜像还以临时 HOME、无生产数据挂载独立启动并通过健康／网页检查。
- 本机 loopback／Tunnel、50 loopback／宿主机 Caddy 四个入口的首页哈希均为 `8950f2f4e1b1cb076f01d0d1a42675759b464375ac62d225c4f2301b4aba0273`。编译后的前端 JS 已检查不含被删除的提示键。
- 两端保留原数据卷、UID/GID 1000:1000、512 MiB 共享内存、`/mnt` RW/rslave 与 rclone 目录 RW 绑定；专用 VM daemon 29.8.1 的 socket 连接通过。应用 UID 可读两个网盘目录及配置；本机已有 rclone 的 `listremotes` 通过，50 仍只挂配置、没有安装 rclone 程序。
- 50 使用原有 `/usr/local/bin/omb-compose` 快进更新，未改变宿主机 Caddy 配置；其完整哈希仍为 `7cc1951ff095404a5001850a9977a9ffe5d36bc45fa42f5b4abbe446e0e1e7b9`，active/enabled，既有 OMB／Orca 路由保留。两端均未启用 Caddy 容器。
- 50 已删除被替换的旧应用镜像、制品归档、源码 bundle、验证脚本和临时构建目录，没有制作用户数据备份。本机保留 `openmausbot-vm:before-codex-accounts-20261015`。没有复制两端的用户数据或账号，没有执行真实 OpenAI 登录、邮箱验证或付费推理。

证据目录为 `.omb-scratch/codex-accounts-20261015/`，包括两端 receipt、`tests.log`、`push.log`、各构建／部署日志、`packaged.log`、`native-and-artifacts.json`、`image-smoke.json` 和 `cleanup-50.log`。50 的 `.omb-scratch/deployment-receipt.json` 仅保存不含凭据或用户内容的运维回执。

## 18. 2026-10-15 再次同步上游（仅源码）

| 项目 | 值 |
| --- | --- |
| 合并前 fork | `6831db27819f3bc4bbe8ef1133a0d1bf568a1999` |
| 共同基线 | `c2cf30127c9fb6fb506be533f361214f764c01da` |
| 固定上游目标 | `de63346e9347abb51048ae74ef3121d125fd11d2` |
| 新增上游范围 | 204 个提交，105 个非合并提交，253 个文件 |
| 分支 | `feature/zpmodified` |
| 本机代码恢复分支 | `safety/before-upstream-20261015-de63346e9` |
| 源码版本 | 0.1.111，上游本轮未提升版本号 |

### 合并内容与定制保留

- 接入上游多套 OpenAI 兼容接口管理、原生提问卡片、浏览器上传／悬停、模型列表刷新、聊天排序、工具失败纠错配置、通知、自部署版本提示和 Claude Code 个人技能目录。
- 上游 Files 是桌面与官方 My Cloud 的文件共享：电脑文件单向上传为云端只读副本，Bot 产物单向下载。当前独立 Docker 服务没有因此新增 Google Drive／OneDrive 接口，现有 `/mnt` 与 rclone 配置挂载仍按第 3 节维护。
- 保留文字／reasoning 流式缓冲和结束清理；代码块同时支持流式阶段延迟高亮与上游的 fence 换行指令。
- 保留 Cursor 面板按需安装、登录、更新及实例 HOME 解析，Cursor／Antigravity 套餐用量，以及第 17 节的两种账号认证与独立 `CODEX_HOME`。
- 保留 HTTP、Tunnel、两种可选 Caddy HTTPS、VM、宿主机文件与 rclone 配置 overlay；没有修改实际部署配置或数据卷。
- Full Access 继续使用上游统一实现。这次上游合并没有修改 Cursor 的模型选择，后续参数适配见第 19 节。

### 冲突与检查说明

- 六个冲突文件：`ChatMarkdown.tsx` 合并流式与换行；`cursor.test.ts` 和 `codex.ts` 保留双方导入与测试；`zh.json`、`source-hashes.json` 逐键三方合并；`file-size-ratchet.test.ts` 根据合并结果重新计数，所有原有大文件的行数上限均未增加。
- 上游新增土耳其语、越南语。两种语言的套餐说明及空账号文案已同步本分支的 Cursor／Antigravity 语义，并更新对应英文源哈希。翻译检查通过：12 个语言包、4542 条英文源字符串。
- Node.js 24.21.0；lint、typecheck、Electron 183 个模块语法检查、server/UI 构建、流式浏览器 fixture 与四种 Compose 配置解析通过。
- 首轮 90 个回归文件中 89 个通过：2826 项通过、1 项跳过，唯一失败是上游新下拉框规范检查发现账号类型表单仍使用原生 `select`。表单已改用共享 `Select`，保留原有类型与提交行为；修正后规范、账号交互、引擎设置三个文件的 30 项测试全部通过。
- 六个隔离 API／端到端文件：57 项通过、2 项按 Linux 平台跳过；涵盖显式账号类型、网页 Full Access、配置工作流、取消、Local VM 与 Files。Electron 文件同步模块的 44 项 Node 测试通过。
- 打包 smoke 在仓库及 `node_modules` 外启动临时服务，通过 13 个代理入口、MCP、headless CLI、导出 worker、容器 launcher、compile cache 与 enterprise 层发现。
- 供应商 Windows 补丁保留上游原始字节；其统一 diff 空上下文行含必要的空格，空白检查排除该补丁，其余暂存文件执行 `git diff --cached --check`。

验证日志位于被忽略的 `.omb-scratch/upstream-sync-20261015-de63346e9/`。所有 API、账号、对话及浏览器验证使用临时 HOME／数据与模拟引擎。

**同步提交当时只更新源码，没有部署。** 随后的第 19 节发布已从包含本次合并的完整 fork SHA 重新构建，并更新镜像中的 `/app/package.json` 与 `deployment-manifest.json`；没有因为版本号仍是 0.1.111 而复用旧应用制品。

## 19. Cursor 参数化模型设置

修改基于同步提交 `313cfb447`，源码版本仍为 0.1.111。修复提交为 `2dce5fc0d524a367b3f9fea398b4b33d9ff07a6a`，已推送至 `origin/feature/zpmodified` 并部署到两端。

- 普通会话与后台 ACP 握手都传入 Cursor 的 `_meta.parameterizedModelPicker: true`。其他引擎不带这个能力，文件／终端能力仍由原有核心逻辑控制。
- `cursor/list_available_models` 提供原生模型名和参数定义。所选 CLI 条目的显示名称映射到对应原生模型及参数；推理字段名、档位和值均使用元数据，不建立 Grok 或 GPT 的型号映射表。显示名称中的上下文与 Thinking 配置一并保留。
- 每轮通过 `session/set_config_option` 设置模型及参数。High 显式设置 `fast=false`，High Fast 设置 `fast=true`；每轮重设参数，避免沿用上一轮的 Fast。没有新增配置回读或设置结果比对，设置请求的结果体不参与判断，RPC 报错正常使当前轮失败。
- 删除旧的“最接近变体”、参数拒绝后沿用其他模型、方法缺失后依赖启动参数等继续执行路径。请求的模型或参数不能解析时直接失败。
- 启动参数不再携带 `--model`；模型选择统一走 ACP。同一线程切换模型时可复用进程，权限、工作目录、凭据或工具范围变化仍按原有契约处理。
- 源码位于 `server/drivers/acp/cursor-model.ts` 和 `cursor.ts`；共享 ACP 核心传递实例模型标签与客户端能力，后台纯文本生成也传递同一客户端能力。核心文件行数上限由 2019 降到 2017。

### 验证范围

- 参数映射、Cursor 驱动、共享 ACP、后台生成、审批矩阵及文件大小检查共 6 个文件、234 项测试最终分批通过。首轮发现 `--model` 导致进程重启，删除后确认 High Fast → High → Medium 在同一 PID 中执行。协议记录明确包含参数设置和 prompt，不包含配置回读；假 CLI 的空确认可继续，拒绝 Fast 则不发送 prompt。
- `lint`、`typecheck`、server 构建与隔离 packaged smoke 通过。打包服务在临时 HOME／数据中验证启动、13 个代理入口、MCP、headless CLI、导出 worker、launcher、compile cache 与 enterprise 层发现。
- 读取当前 Cursor 2026.10.14 的模型元数据，对 45 个原生模型基类与 CLI 返回的 259 个模型条目做离线映射，均可解析。这是模型配置映射证据，没有发起真实模型推理。
- 假 CLI 与协议测试使用隔离数据；真实 CLI 目录查询只取得模型元数据，ACP 查询使用临时配置副本，结束后删除。未更改生产账号、会话、Compose 或运行中的镜像。

证据目录为被忽略的 `.omb-scratch/cursor-parameters-20261015/`，包含模型元数据、映射汇总、分批测试、静态检查、构建和打包日志。

### 两端部署结果（2026-10-15）

本次同时发布第 18 节的上游同步和本节的 Cursor 修复。发布标签为 `openmausbot-vm:0.1.111-2dce5fc0d`，运行标签仍为 `openmausbot-vm:local`。

| 项目 | 本机 | 50 |
| --- | --- | --- |
| 制品源码 SHA | `2dce5fc0d524a367b3f9fea398b4b33d9ff07a6a` | 同左 |
| 上游基线 | `de63346e9347abb51048ae74ef3121d125fd11d2` | 同左 |
| `/app/package.json` 版本 | `0.1.111` | 同左 |
| 实际镜像 ID | `sha256:ac2b26bb456f6e8ce5c29b52f0e37addbe7327bf954e0a073d4bd424a4e7082a` | `sha256:dc5dbf047ec2b8351abeaba690f0724f024e8f40ee9502d4b583071723c9ea53` |
| Compose | 基础 + VM + Tunnel + mnt + rclone | 基础 + VM + mnt + rclone |
| HTTP 映射 | `0.0.0.0:8080 → 8799` | `127.0.0.1:8080 → 8799` |
| 公网入口 | `https://omb.oomdev.de5.net` | `https://ombus.oomdev.de5.net` |
| 状态 | healthy，RestartCount 0 | healthy，RestartCount 0 |

- 从干净的已提交源码清空 server/UI 输出后重新构建，并准备锁定版本的 DuckDB、resvg、1Password 资源。推送前 lint、typecheck 和 12 个语言包的翻译检查通过；英文源字符串为 4542 条。
- 独立 packaged smoke 通过：仓库及 `node_modules` 外启动、13 个代理入口、MCP、headless CLI、隔离导出 worker、launcher、compile cache 和 enterprise 模块发现。前端构建成功，仍报告既有大 chunk 与 CSS `::highlight` 识别警告，没有调整这些构建规则。
- 继续使用第 11 节的制品覆盖方法，两端基础镜像均为 `sha256:6474542e76e44ef73280a82dbd61600e5c243905beeb60c896710d3890a790c2`，没有重新安装持久 HOME 内的引擎。镜像内 `deployment-manifest.json` 记录完整 fork／上游 SHA、构建时间及逐文件校验值。
- 两台最终镜像的 **1299 个应用制品文件**全部校验通过，聚合 SHA-256 为 `fccf3619163c3fbef88da59b798e7211ddc1fb44a03f59efd4b1ed7ba1f6f251`。一次性无网络容器通过 DuckDB SQL、resvg PNG、1Password SDK 加载及 WASM 校验；本机最终镜像还以临时 HOME、无生产数据挂载独立启动，通过健康及网页检查。
- 本机 loopback／Tunnel、50 loopback／宿主机 Caddy 四个入口的健康接口与首页通过，首页 SHA-256 均为 `2c0d80163b19e35581e5d9df477be903f59ccd2709be12eea63fbfd762864e59`。
- 两端更新前后数据卷、UID/GID 1000:1000、512 MiB 共享内存、端口、VM socket、`/mnt` RW/rslave 与 rclone 目录 RW 绑定一致。应用 UID 可读两个云盘目录及配置；本机已有 rclone 的 `listremotes` 通过，50 仍只挂配置、没有安装 rclone 程序。
- 专用 VM daemon 29.8.1 连接通过；dind 与本机 cloudflared 均连接重新创建后的应用网络命名空间。两端继续使用原有 Compose 组合，未运行 Caddy 容器。
- 50 使用原有 `/usr/local/bin/omb-compose` 更新，宿主机 Caddy active/enabled，配置哈希仍为 `7cc1951ff095404a5001850a9977a9ffe5d36bc45fa42f5b4abbe446e0e1e7b9`，既有 OMB／Orca 路由保留。源码仓库通过完整 bundle 校验后快进。
- 50 已删除被替换的旧应用镜像、制品归档、源码 bundle、校验脚本和临时构建目录，没有制作用户数据备份。本机保留 `openmausbot-vm:before-cursor-parameters-20261015`。文档提交仅更新源码工作树，不因此再重建或重启应用。
- 未发送邮箱验证码、生成生产配对码或发起真实付费模型推理。Cursor 参数协议的证据来自前述隔离测试；部署检查证明制品、入口、容器、挂载与 VM 连接，不扩大为实际模型推理结果的证明。

发布证据位于 `.omb-scratch/cursor-parameters-deploy-20261015/`，包括两端 receipt、`push.log`、构建／部署日志、两端原生模块与文件校验、`image-smoke.json`、`cleanup-50-final.log`。50 仅保留不含凭据或用户内容的 `.omb-scratch/deployment-receipt.json` 运维回执。

## 20. HighLevel 与消息配色同步（2026-10-15）

| 项目 | 值 |
| --- | --- |
| 合并前 fork | `945cda8c5df55ff21f5acb856a72c5a5cec33a4f` |
| 上次上游基线 | `de63346e9347abb51048ae74ef3121d125fd11d2` |
| 本轮固定上游目标 | `2c98018a4e2eed4c5f1634f2610087428a7f0dd2` |
| 上游新增范围 | 22 个提交，15 个非合并提交，79 个文件 |
| 版本 | 0.1.111，依赖清单与锁文件未变 |
| 本机恢复分支 | `safety/before-upstream-20261015-2c98018a4` |

### 合并与收敛

- 纳入原生 HighLevel 连接卡片、OAuth／Private Integration token、20 项 CRM 工具及按 Bot 授权；当前工具不发送消息、不修改预约、不处理支付。OAuth 默认使用上游的 accounts relay；本轮 Docker 发布不部署 Cloudflare Worker，也不验证真实 CRM 账号。
- 纳入单聊用户消息的 Bot 色渐变、对比度与默认开启设置；显式关闭和群聊的原有行为保留。
- 纳入官方 Composio broker 自定义认证配置，以及最新的清单测试、Windows crash log／Files／room session 修正。
- 保留 Cursor 参数化 ACP 设置、按需安装／登录／更新、套餐用量、独立 Codex 设备码账号、文字／reasoning 流式，以及现有 Docker／VM／网盘挂载。
- 唯一文本冲突是文件行数基线。连接应用的四个读取路由移至 `server/routes/connector-read.ts`；引擎信息类型移至 `src/state/instance-info.ts`，保留原导出；应用图标组件移至 `src/components/ServiceIcon.tsx`，保留原入口与行为。
- 所有已有大文件上限均未增加：index 17711 → 17690，前端 store 3648 → 3587，PluginsPanel 1111 → 1091，Claude 2169 → 2168，Codex 1836 → 1834；index 的精确路由判断计数 111 → 107。
- 上游新 OAuth 测试发现 state 文本别名：更改 Base64URL 末尾的未使用位可能仍解码为相同字节。HighLevel relay 的 HKDF 输入改用完整 state 文本，保留原有错误 state 拒绝断言，并新增确定性回归。这只涉及本轮新增的 HighLevel relay，不迁移已有应用账号或其他认证数据。

### 发布顺序与证据

本轮按用户要求先部署，再完成正式合并提交。构建前冻结暂存源码树，并固定待提交对象的树、两个父提交、消息及作者／提交时间；分支在部署通过前保持原 HEAD。镜像中的 `deployment-manifest.json` 记录该完整源码对象 SHA 和源码树 SHA，构建及切换前核对暂存树与工作文件没有变化。部署通过后使用相同元数据完成提交并核对对象 SHA，再推送与同步 50 的源码工作树。

发布继续使用同一份编译制品覆盖固定基础运行时。现有完整 Compose 组合、数据卷、端口、512 MiB 共享内存、专用 VM socket、`/mnt` RW/rslave 与 rclone 目录绑定必须保留；50 不制作数据备份、不保留旧应用镜像或上传归档。

本轮验证与发布日志位于被忽略的 `.omb-scratch/upstream-sync-20261015-2c98018a4/`。两端部署通过后完成的正式合并提交为 `e5f7f47abb8ac80415e06d60558c3212bd54113b`，与构建前固定的对象 SHA 完全一致；源码树为 `5719d5a8241d541512595975d47039e47572ba32`。

### 验证结果

| 检查 | 结果 |
| --- | --- |
| 主应用回归 | 36 个文件，1467 项通过；1 项 Windows 专用权限管道测试在 Linux 跳过。覆盖 HighLevel、连接应用、消息配色、Cursor／Claude／Codex／Pi、权限、流式、用量、VM、Files、Store 与 API 清单 |
| Composio broker | 1 个文件，26 项通过 |
| HighLevel relay 与 control plane | 修正 state 文本别名后，2 个文件、40 项通过 |
| Electron 诊断 | 1 个文件，65 项通过 |
| 静态检查 | Node 24 typecheck、lint、12 个语言包／4559 条英文源字符串检查、183 个 Electron 模块语法检查通过 |
| Control plane 类型 | 先生成 `worker-configuration.d.ts`，再通过独立 TypeScript 检查；生成物不入库 |
| 构建与隔离启动 | 清空 server/UI 输出后构建成功；packaged smoke 在仓库与 node_modules 外通过启动、13 个代理入口、MCP、headless CLI、隔离导出 worker、launcher、compile cache 与 enterprise 层发现 |

共 1598 项测试通过，1 项按平台跳过。没有运行完整跨平台测试集；所有登录、授权、Bot 与消息写入验证均使用临时 HOME／数据与模拟提供方。真实邮箱验证码、生产配对码、真实 CRM 登录和付费模型推理未用于本轮验证。

### 两端发布结果

发布标签为 `openmausbot-vm:0.1.111-e5f7f47ab`，运行标签仍为 `openmausbot-vm:local`；两端 `/app/package.json` 均为 0.1.111。基础镜像保持 `sha256:6474542e76e44ef73280a82dbd61600e5c243905beeb60c896710d3890a790c2`，没有重新安装持久 HOME 内的引擎。

| 项目 | 本机 | 50 |
| --- | --- | --- |
| 制品源码 | `e5f7f47abb8ac80415e06d60558c3212bd54113b` | 同左 |
| 上游基线 | `2c98018a4e2eed4c5f1634f2610087428a7f0dd2` | 同左 |
| 实际镜像 ID | `sha256:39d3215ee89f9ffac6dddb91fce81e4f66b14f7f6c32ceac448504e30592ed22` | `sha256:be63a7dd6398b418cee8d57edce6fac19824f5ae78899fe57d4d0a156d96ce53` |
| Compose | 基础 + VM + Tunnel + mnt + rclone | 基础 + VM + mnt + rclone |
| HTTP 映射 | `0.0.0.0:8080 → 8799` | `127.0.0.1:8080 → 8799` |
| 公网入口 | `https://omb.oomdev.de5.net` | `https://ombus.oomdev.de5.net` |
| 状态 | healthy，RestartCount 0 | healthy，RestartCount 0 |

- 两端最终镜像的 **1312 个应用制品文件**全部核对通过，聚合 SHA-256 为 `f53fafa4bea34450d047148bca98a0a6a6d29f9d5ef3767580eebed6228d1ee2`。`deployment-manifest.json` 包含完整源码 SHA、源码树 SHA、上游 SHA、构建时间及逐文件哈希。
- 一次性无网络容器通过 DuckDB SQL、resvg PNG、1Password SDK 加载与 WASM 校验；本机最终镜像用临时 HOME、无生产数据挂载独立启动，通过健康与网页检查。
- 本机 loopback／Tunnel、50 loopback／宿主机 Caddy 四个入口的健康接口和首页通过，首页 SHA-256 均为 `675cde4dd898a614031fea431884b8d1a76a6ba0851b1681fa63b2b78f088ff3`。
- 原有数据卷、UID/GID 1000:1000、512 MiB 共享内存、端口、专用 VM socket、`/mnt` RW/rslave、rclone 目录 RW 绑定保持一致。专用 VM daemon 29.8.1 可连接，dind 与本机 cloudflared 连接新应用网络命名空间。
- 应用 UID 可读 Google Drive／OneDrive 目录及 rclone 配置；本机已有 rclone 的 `listremotes` 通过，50 仍只挂配置、没有安装 rclone 程序。
- 50 宿主机 Caddy active/enabled，配置哈希仍为 `7cc1951ff095404a5001850a9977a9ffe5d36bc45fa42f5b4abbe446e0e1e7b9`，既有 OMB／Orca 路由保留；两端没有运行 Caddy 容器。
- 50 已删除旧应用镜像、构建归档、验证脚本和临时构建目录，没有制作用户数据备份。本机保留 `openmausbot-vm:before-sync-2c98018a4-20261015`。源码 bundle 仅用于校验后快进并在完成时删除，后续部署文档提交不重建镜像。

主要证据为两端 receipt、`frozen-source.json`、`commit.log`、`tests.log`、`broker.log`、`control-plane-final.log`、`diagnostics.log`、构建／部署日志、两端原生模块与文件校验、`image-smoke.json`、`cleanup-50-final.log` 及推送／源码同步日志。50 仅保留不含凭据或用户内容的 `.omb-scratch/deployment-receipt.json` 运维回执。

## 21. 0.1.116 上游同步与两端发布（2026-10-19）

### 固定范围与发布顺序

| 项目 | 值 |
| --- | --- |
| 合并前 fork | `2fcf5270511155a8dba0be336b5dbd1660af8905` |
| 上次上游基线 | `2c98018a4e2eed4c5f1634f2610087428a7f0dd2` |
| 本轮上游目标 | `c216147c3710e012941739a24d36cabaf3c62a8d` |
| 上游范围 | 493 个提交，356 个非合并提交，1177 个文件 |
| 正式合并／制品源码 | `f345225a6dacde8e4248e6ad0755e0bfba8c8c5e` |
| 源码树 | `2d3dcdfac5ea4b52111db9790e8995a85ac4eb02` |
| 源码版本 | `0.1.116` |
| 本机代码恢复分支 | `safety/before-upstream-20261019-c216147c3` |

按本轮用户要求，先完成本机和 50 部署，再完成正式合并提交与推送。继续采用第 20 节的冻结源码树与提交元数据方式，镜像内记录的完整源码 SHA 与最终合并提交一致。
最终编译后仅调整两份测试文件；已逐项确认运行时代码输入未变，再冻结最终源码树与制品。部署记录作为后续文档提交，不重新创建应用容器。

### 本轮功能与收敛

- 合入统一 Automations、应用事件触发、计划任务恢复、额度重置后继续，以及相关通知、日历与管理界面。
- 合入引擎状态探测的并发复用与短时缓存、CLI 退出与超时处理、ACP dispose 的部分回复保存，以及 Antigravity Full 模式使用原生 yolo。
- 合入浏览器 CDP 服务与查看面板、浏览器身份／凭据交互、团队地图的电脑状态与屏幕、Simple 界面、GrokBot 导入、X research 和记忆批处理。
- Live 通话采用上游自有 OpenAI Key 流程，移除旧 Pro 资格开关；`compose.yaml`、`.env.example`、Docker README 和两端 `.env` 同步清理。
- 保留线程级文字／reasoning 流式订阅、50 ms 服务端合并与前端缓冲清理。真实聊天与流式 fixture 已核对。
- 保留 Cursor 参数化接口与 High／High Fast 的独立设置、面板按需安装／登录／更新、Cursor／Antigravity 套餐显示和两种 Codex 账号认证。
- 套餐用量和额度恢复共用 `shared/plan-usage.ts` 的提供方类型。自动恢复窗口仍按上游 Claude／Codex／Grok 的现有规则判断；Cursor／Antigravity 的原有套餐显示保留。
- HighLevel relay 收敛到上游的 canonical Base64URL state 校验与派生契约，移除第 20 节的 fork 文本派生修补；Worker 测试通过。本轮没有发布 Cloudflare Worker。
- 连接应用读取路由保留在 `server/routes/connector-read.ts`，接入上游 managed setup 参数；原有 UI 类型与图标模块提取保留。
- 配置缓存的 stat 标识增加 mode／uid／gid。本机实测快速 chmod 时 ctimeNs 可以相同，不能仅依赖时间戳判断权限变化。已有配置缓存测试已覆盖本次修正。
- 通用 fake ACP CLI 保持可复制为独立文件，Cursor 模型 fixture 从 Cursor 测试注入；自包含 guard 覆盖 fake ACP。Codex 模型目录测试显式使用自己的 `CODEX_HOME`，符合分支的账号隔离契约。
- 浏览器出站测试检查本次请求的拒绝说明与公开页面正常加载。Chrome 自身的额外探测也会进入同一 gate；本机 DNS 曾给 Google 返回保留的 `2001::1`，因此不能假定整批 notice 只包含测试页面的一次请求。生产拦截规则未变，notice 格式由独立测试验证。
- 原有文件行数上限没有提高：index 17690 → 17226，前端 store 3587 → 3551，PluginsPanel 1091 → 1084；其余按实际源码同步收紧或保持。

### 验证记录与范围

| 检查 | 结果 |
| --- | --- |
| 主应用首轮选择 | 123 个文件；2368 项通过、21 项失败、95 项跳过。失败集中于 Antigravity fixture、配置权限缓存、Codex 目录 fixture 与浏览器 notice 四个文件，随后均已修正并重跑通过 |
| 合并适配重跑 | Antigravity／Cursor／额度重置及 fixture，6 个文件、126 项通过 |
| 配置与源码门禁重跑 | 3 个文件、206 项通过 |
| Codex 目录与 fixture guard | 2 个文件、23 项通过 |
| 浏览器出站与 notice | 2 个文件、12 项通过、1 项仅 CI 执行的 Chrome 存在检查跳过 |
| 真实 Chrome CDP | 页面、操作、Stream V2 三个文件，62 项通过 |
| 真实聊天 UI 与流式 | 搜索、密钥表单、发送／工具／回复和流式尾部清理分别通过；首次部分页面启动超时，重跑相同页面检查通过 |
| Composio broker | 2 个文件、77 项通过，独立类型检查通过 |
| Control plane | 6 个文件、130 项通过，先生成类型再通过独立类型检查 |
| 静态检查 | Node 24 typecheck、lint、12 个语言包／6017 条英文源字符串、203 个 Electron 模块语法检查通过 |
| 打包启动 | 在仓库与 node_modules 外通过启动、13 个代理入口、MCP、headless CLI、隔离导出 worker、launcher、compile cache 与 enterprise 层发现 |

分批计数有重叠，不将它们相加作为一轮完整测试总数。没有运行完整跨平台测试集。
登录、账号、Bot、消息、浏览器和权限写入检查全部使用隔离 HOME／数据与模拟提供方；没有发送生产邮箱验证码、生成生产配对码、验证真实 CRM 登录或发起付费模型推理。

本轮类型检查超过 Node 默认 2 GiB 堆限制；指定 `NODE_OPTIONS=--max-old-space-size=4096` 后通过。
后续在本机执行大范围 typecheck／构建／push 时可在命令环境指定该值；本次没有修改应用运行容器的堆设置。

### 两端发布结果

发布标签为 `openmausbot-vm:0.1.116-f345225a6`，运行标签为 `openmausbot-vm:local`。
两端 `/app/package.json` 均更新到 0.1.116；`/app/deployment-manifest.json` 记录上述源码／源码树／上游 SHA、构建时间和逐文件哈希。
基础运行时保持 `sha256:6474542e76e44ef73280a82dbd61600e5c243905beeb60c896710d3890a790c2`。

| 项目 | 本机 | 50 |
| --- | --- | --- |
| 制品源码 | `f345225a6dacde8e4248e6ad0755e0bfba8c8c5e` | 同左 |
| 上游基线 | `c216147c3710e012941739a24d36cabaf3c62a8d` | 同左 |
| 实际镜像 ID | `sha256:6f3dc50e596e91cb5e0efa5eb0ebaf0d5adec4f4b94cd2372e75f4ed2b5a8e0e` | `sha256:fd606f6542c503eaf23f4570b1b668550cef9d2cd36fdb6a47b00aff5b4e5fee` |
| Compose | 基础 + VM + Tunnel + mnt + rclone | 基础 + VM + mnt + rclone |
| HTTP 映射 | `0.0.0.0:8080 → 8799` | `127.0.0.1:8080 → 8799` |
| 公网入口 | `https://omb.oomdev.de5.net` | `https://ombus.oomdev.de5.net` |
| 状态 | healthy，RestartCount 0 | healthy，RestartCount 0 |

- 两端 1461 个制品文件核对通过，聚合 SHA-256 为 `692e405a42b1080c696205d61e29da4f8b32afe757c051674605307d2c8dca53`。
- 隔离无网络容器通过 DuckDB SQL、resvg PNG、1Password SDK 加载与 WASM 校验；本机最终镜像以临时 HOME、无生产数据挂载独立启动通过。
- 两端 loopback 与两个公网域名四个入口的健康和首页检查通过，首页 SHA-256 均为 `d888ad6ddafef16057589458e5d52659807faed8f5450db6c62b14e0f083698e`。
- 数据卷、UID/GID 1000:1000、512 MiB shm、端口、专用 VM socket、`/mnt` RW/rslave 与 rclone 配置 RW 挂载均保留。VM daemon 29.8.1 可连接，dind／本机 cloudflared 使用新应用网络命名空间。
- 两个网盘挂载可读，rclone 配置可读写；本机现有 rclone 的 `listremotes` 通过，50 仍只挂配置目录、没有安装 rclone 程序。
- 50 宿主机 Caddy active/enabled；本轮配置哈希为 `509d3ead5fab7d7efc8a03b23e491e04051bf264fc124555635db850a87f1e1b`，与本轮操作前一致。保留其现有全部站点，没有重载网关、修改 DNS 或运行 Caddy 容器。
- 50 已清理被替换的旧应用镜像、失败构建的临时镜像、上传归档／验证脚本与临时构建目录，没有制作用户数据备份。源码 bundle 校验、快进后删除。本机保留 `openmausbot-vm:before-sync-c216147c3-20261019`。

### 后续维护注意

1. **制品权限**：构建目录可能继承宿主机严格 umask。仅对待打包的公开代码制品将目录设为 0755、普通文件设为 0644，并保留可执行文件的执行位。当前基础镜像 maus 是 UID 1001，Compose 应用使用 UID 1000，发布前须以 UID 1000 校验全部制品可读。不要把这一权限操作应用到 HOME、凭据或用户数据。
2. **挂载比对**：Docker inspect 返回挂载数组的顺序可能改变；按 Destination 排序后核对属性，不能因数组顺序不同误判部署配置变化。
3. **先部署后提交**：冻结最终源码及提交对象；50 若需要提前使用已更新的 Compose，仅替换经哈希核对的该文件。部署通过后，核对这份临时修改确属本轮，再恢复该文件的旧工作树版本并立即快进到正式提交。不要重置其他文件或覆盖用户修改。
4. **部署同一制品**：两端镜像 ID 可因本机构建元数据不同而不同；应核对源码 SHA、源码树、版本、上游 SHA、逐文件及聚合哈希。
5. **验证范围**：健康检查和挂载读取不能证明每个真实供应商账号都能推理、每个网盘 OAuth 仍有效或所有云功能均已配置；按任务需要再做相应真实操作。

证据位于被忽略的 `.omb-scratch/upstream-sync-20261019-c216147c3/`：两端 before／receipt、冻结源码与提交日志、分批测试、浏览器证据、静态检查、构建／打包／原生模块校验、部署、清理、推送及源码同步日志。
50 仅保留不含凭据或用户内容的 `.omb-scratch/deployment-receipt.json` 运维回执。

## 22. 0.1.127 上游同步与两端发布（2026-10-26）

### 固定范围与源码

| 项目 | 值 |
| --- | --- |
| 合并前 fork | `fa4d23f52b2d0974beb9fea8ff9b536413c1230e` |
| 上次上游基线 | `c216147c3710e012941739a24d36cabaf3c62a8d` |
| 本轮固定上游目标 | `0d8eacc65cd3b783a0d28d019d39e6367780b911` |
| 上游范围 | 999 个提交，607 个非合并提交，1932 个文件 |
| 正式合并／制品源码 | `74485aa665feb15da60e032f150dd0be5bcac3dc` |
| 源码树 | `1ece6ebcc828dd24bced6df9c34d2876b2a6fb22` |
| 应用版本 | `0.1.127` |
| 本机代码恢复分支 | `safety/before-upstream-20261026-0d8eacc65` |

沿用第 20 节的冻结源码树与提交元数据流程，先完成两端部署，再完成正式合并提交。
最终合并对象与部署前计算的源码 SHA 完全一致；部署文档作为后续独立提交，不重建镜像。
没有把合并目标切换到其他上游提交。该目标的 Antigravity runtime 仍固定为 1.1.1，本轮没有另行升级它。

### 合并与定制收敛

- 解决 17 个文本冲突文件，接入上游手机工具、桌面更新／恢复、Custom ACP 模型与推理参数、连接应用和聊天界面更新。
- ACP 初始化统一使用 `clientCapabilitiesMeta`，普通对话与后台文本请求都把参数化选模能力放在 `clientCapabilities._meta`；保留 Custom ACP 的 `configOptions`。
- Cursor 继续按提供方元数据设置模型、推理与 Fast；不引入上游的旧变体替换、不因设置失败改用默认模型、不增加配置回读核验。保留实例 HOME 内的 CLI 解析和面板安装／登录／更新。
- 保留独立 Codex 设备码账号和 ChatGPT plan 流程、各自凭据目录及用量入口，并接入上游 Codex 版本读取和后台路由。
- 连接应用的四个读取路由继续放在 `server/routes/connector-read.ts`，纳入手机工具和上游完整连接清单状态，避免恢复 index 中的重复路由。
- 引擎信息类型继续放在 `src/state/instance-info.ts`，补上设备／Data 工具能力；图标组件采用上游同名提取结果。套餐文案的两条新波兰语翻译同步到 fork 的提供方范围。
- 消息脱敏采用上游提取的 `server/message-redaction.ts`，在同一实现中保留工具标题长度限制；公开聊天投影继续移除大型原始字段。
- 保留文字／reasoning 的线程订阅与尾部清理、流式代码和 Mermaid 的延迟渲染、HTTP UUID 兼容、单端口 `/hooks/` 以及按访问源生成的 VM 查看地址。
- VM 状态包含上游桌面更新信息；隔离 VM fixture 同时保留旧镜像／缺失镜像语义与动态查看端口。
- 本分支原有文件行数上限没有提高：index 17226 → 16589，前端 store 3551 → 3431，ACP core 2010 → 1804，Codex 1834 → 1813，PluginsPanel 1084 → 1034。index 的精确路径判断 104 → 88，`startsWith` 10 → 7，继续计入应用端口的直接 webhook 入口。小于 1000 行的 SettingsModal 从大文件表移除。

### 验证记录与范围

| 检查 | 结果 |
| --- | --- |
| 主应用回归 | 129 个文件：121 个通过、1 个失败、7 个跳过；2556 项通过、7 项失败、101 项跳过。最先启动的 routine-recovery 文件因合并时的重复导入失败，修正后该文件 7 项全部重跑通过 |
| VM、手机与账号补充回归 | 20 个文件，196 项通过、2 项跳过；覆盖真实隔离服务器上的群聊／Goal VM、桌面更新、查看器授权、手机路由及账号 API |
| 真实聊天 UI 与流式 | 首轮两个文件 3 项通过、1 项失败；发送／工具／回复、密钥表单及流式尾部清理通过。搜索用例首次打开页面超时，随后相同用例重跑通过 |
| Composio broker | 3 个文件，92 项通过 |
| 源码／路由门禁 | 最终独立重跑两个文件，2 项通过 |
| 静态检查 | Node 24 typecheck、lint、13 个语言包／6334 条英文源字符串检查、264 个 Electron 模块语法检查通过 |
| 构建与打包 | server／UI／DuckDB 构建通过；仓库与 node_modules 外的启动、13 个代理入口、MCP、headless CLI、导出 worker、launcher、compile cache 与 enterprise 层发现通过 |
| 最终运行镜像 | 两端各通过 1700 个制品文件哈希、DuckDB SQL、resvg PNG、1Password SDK 加载与 WASM 校验；本机最终镜像在无网络、临时 HOME、无生产数据挂载下启动通过 |

分批测试包含重跑和重叠，不将它们相加作为一轮完整测试总数。没有运行完整跨平台测试集，也没有发布 Cloudflare Worker。
账号、Bot、消息、浏览器、VM 和权限写入验证均使用隔离 HOME／数据与模拟提供方；没有发送生产邮箱验证码、生成生产配对码或发起付费模型推理。
健康与挂载检查不能证明真实供应商账号仍能推理、每个网盘 OAuth 仍有效或全部云功能已配置。

### 两端发布结果

发布标签为 `openmausbot-vm:0.1.127-74485aa66`，运行标签保持 `openmausbot-vm:local`。
两端 `/app/package.json` 均为 0.1.127，`deployment-manifest.json` 记录同一源码／源码树／上游 SHA 与逐文件哈希。
基础运行时仍为 `sha256:6474542e76e44ef73280a82dbd61600e5c243905beeb60c896710d3890a790c2`。

| 项目 | 本机 | 50 |
| --- | --- | --- |
| 制品源码 | `74485aa665feb15da60e032f150dd0be5bcac3dc` | 同左 |
| 实际镜像 ID | `sha256:b4c0570f354533207ec6c6ceca5532214b8147f84868a850f6d6ccb44168e618` | `sha256:ddbc5bb8f21dc26ee376b620a4b7a5a92e8a2048d1c00991974ccc8fb32a0924` |
| Compose | 基础 + VM + Tunnel + mnt + rclone | 基础 + VM + mnt + rclone |
| HTTP 映射 | `0.0.0.0:8080 → 8799` | `127.0.0.1:8080 → 8799` |
| 公网入口 | `https://omb.oomdev.de5.net` | `https://ombus.oomdev.de5.net` |
| 状态 | healthy，RestartCount 0 | healthy，RestartCount 0 |

- 两端 1700 个制品文件的聚合 SHA-256 为 `a60937d557615424fd67ad4482f45f4e8de772c01b4adbac0eba43803ea96227`。
- 本机 loopback／Tunnel 和 50 loopback／宿主机 Caddy 四个入口的健康及首页检查通过，首页 SHA-256 均为 `ea966c5ccce6d08810e9db703374751eda507427b082d8ce457249dd4d27fc31`。
- 各自的数据卷、UID/GID 1000:1000、512 MiB shm、端口、专用 VM socket、`/mnt` RW/rslave 和 rclone 配置目录 RW 挂载与本轮操作前一致；VM daemon 29.8.1 可连接，dind 和本机 cloudflared 使用新应用网络命名空间。
- 两端网盘目录及 rclone 配置可读，配置目录可写。本机现有 rclone 的 `listremotes` 通过；50 仍只挂配置目录，没有安装 rclone 程序。
- 50 的 Caddy active/enabled，配置哈希为 `4e2a6a7862d352d17b8af4ed96af99faee1f55590bb3323b3e05b02449460a12`，与本轮操作前相同；没有重载 Caddy 或修改 DNS。

50 已通过完整源码 bundle 校验并快进到正式合并提交；被替换的旧应用镜像、源码 bundle、上传归档、验证脚本与临时构建目录均已删除，没有制作用户数据备份。本机保留 `openmausbot-vm:before-sync-0d8eacc65-20261026`。

证据位于被忽略的 `.omb-scratch/upstream-sync-20261026-0d8eacc65/`：两端 before／receipt、冻结源码与提交日志、分批测试与重跑、UI 证据、静态检查、构建／打包／原生模块校验、部署、清理、推送及源码同步日志。
50 仅保留不含凭据或用户内容的 `.omb-scratch/deployment-receipt.json` 运维回执。
