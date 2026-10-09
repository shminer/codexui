# codexui

当前版本：**1.1.0**。基于 Codex app-server 的浏览器界面，支持桌面和移动设备。

本项目保留 `private: true`，从当前仓库本地安装；没有发布 `codexui` npm 包，请勿使用 `npx codexui` 获取本项目。

## 命令

| 命令 | 用途 | 默认监听与暴露方式 |
| --- | --- | --- |
| `codexui` | 普通入口，保留上游行为 | 监听 `0.0.0.0`；Cloudflare 隧道可用 `--no-tunnel` 关闭 |
| `codexui-safe` | 带策略限制的生命周期入口 | 默认监听 `127.0.0.1:5900`；远程访问需显式启用 Tailscale Serve |

包仅提供这两个命令，不再提供 `codexapp`、`codex-mobile`、`codex-mobile-safe` 别名。Codex CLI 仍是独立依赖，名称保持 `codex`。

## 本地安装

需要 Node.js 18+、pnpm，以及可用的 Codex CLI。

```bash
git clone https://github.com/zonghang-li/codex-mobile.git
cd codex-mobile
pnpm install
pnpm run install:local
```

Linux/macOS 默认安装到 `${HOME}/.local`，请将 `${HOME}/.local/bin` 加入 `PATH`。可通过 `PREFIX` 或原有的 `CODEX_MOBILE_PREFIX` 指定安装位置。

Windows 使用同一个 `pnpm run install:local` 命令，安装器自动调用批处理脚本，默认使用 `npm prefix --global` 指向的位置；该路径需加入 `PATH`。

```bash
codexui --version
codexui-safe --version
codexui --help
codexui-safe doctor
```

两个 `--version` 均应显示 `1.1.0`，只查询版本，不启动服务器或登录流程。

### 旧安装注意事项

安装器只安装当前包，不卸载旧包、不删除旧链接、不迁移服务。旧包若已占用 `codexui` 命令，请先检查对应安装前缀和命令来源，人工卸载旧包后再安装本项目，避免直接覆盖现有链接。

旧 `codex-mobile-safe.service` 不会自动切换到新服务。部署新服务前，需人工停止、禁用并移除旧 unit，再执行下述服务安装流程，避免两个服务竞争同一端口。仅在确定需要替换现有服务时执行这些操作。

## 启动

普通入口的本地启动示例：

```bash
codexui --no-tunnel --no-open
```

策略入口的前台启动示例：

```bash
codexui-safe start /path/to/project --no-open
```

默认生成受权限保护的密码文件。也可使用已有文件，文件需属于当前用户、非空，权限为 `0600` 或更严格：

```bash
codexui-safe start /path/to/project \
  --password-file ~/.codex/codex-mobile-safe-password \
  --no-open
codexui-safe status
codexui-safe urls
```

Tailscale 暴露和回收需要显式执行：

```bash
codexui-safe expose tailscale
codexui-safe unexpose
codexui-safe stop
```

## Linux 用户服务

仅适用于 systemd 用户服务环境：

```bash
pnpm run service:install
pnpm run service:status
pnpm run service:restart
journalctl --user -u codexui-safe.service -n 100
```

源码模板为 `packaging/systemd/codexui-safe.service.in`，安装后的 unit 为 `codexui-safe.service`。安装器会按需生成密码文件并启动服务；Tailscale Serve 仍需单独启用。注销后持续运行可由管理员配置 `loginctl enable-linger "$USER"`。

前台策略入口默认使用 `workspace-write`、`on-request`。现有服务模板显式使用 `danger-full-access`、`never`，本次更名保留该配置；部署前请确认符合自己的运行需求。默认 loopback 监听、密码认证和路径/RPC 限制均保持不变。

移除新服务使用 `pnpm run service:uninstall`，密码文件与 Tailscale Serve 配置保留，不自动清理。

## 数据与更新

| 项目 | 更名后的处理 |
| --- | --- |
| 普通入口密码 | 保留原路径 `~/.codex/codexui-password` |
| 策略入口密码 | 保留 `~/.codex/codex-mobile-safe-password` |
| 托管进程状态 | 保留 `~/.codex-mobile-safe` 与 `CODEX_MOBILE_SAFE_HOME` |
| 配置环境变量、Cookie、localStorage 键 | 保留原标识，主题、语言、草稿等沿用原数据 |
| 仓库目录、Git remote | 保持原样 |

更新当前仓库后，可重新运行 `pnpm install`、`pnpm run install:local`；已部署新 unit 时再按需运行 `pnpm run service:restart`。

出现移动端 RPC HTTP 502 时，先检查服务状态、日志、`127.0.0.1:5900` 监听、`codexui-safe doctor` 和 `tailscale serve status`，不要通过放开监听地址处理后端不可达。

## 开发与来源

工程说明见 [Agent Guide](docs/AGENT_GUIDE.md)，手动检查目录见 [tests.md](tests.md)。旧测试文档中的 npm/npx 场景属于上游发布流程，不适用于当前私有包。

本项目沿用 MIT 许可，详见 [LICENSE](LICENSE)。保留上游作者 Pavel Voronin、Igor Levochkin 的归属。相关仓库：

- 当前仓库：[zonghang-li/codex-mobile](https://github.com/zonghang-li/codex-mobile)
- 上游：[friuns2/codex-mobile](https://github.com/friuns2/codex-mobile)
- 原始项目：[pavel-voronin/codex-web-local](https://github.com/pavel-voronin/codex-web-local)
