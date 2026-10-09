# codexui 1.1.0 包命令与服务更名

## 前提

- 本地仓库依赖已安装；包为 `codexui@1.1.0` 且 `private: true`。
- 构建、运行时测试和安装须由人工执行；Agent 仅执行当前约定允许的静态检查。
- 安装检查使用独立临时前缀，不操作现有服务、密码或用户数据。

## 操作与预期

| 操作 | 预期 |
| --- | --- |
| 检查 `package.json` | 名称 `codexui`、版本 `1.1.0`、`private: true`；`bin` 仅有 `codexui` 和 `codexui-safe` |
| 人工执行 `PREFIX=/tmp/codexui-brand-check pnpm run install:local` | 安装当前仓库，不卸载旧包、不清理旧别名；新前缀只生成两个新命令 |
| 执行 `/tmp/codexui-brand-check/bin/codexui --version` 与 `/tmp/codexui-brand-check/bin/codexui-safe --version` | 均仅输出 `1.1.0`，不登录、不安装 Codex、不监听端口、不创建密码或进程状态 |
| 两个命令分别执行 `--help` | 帮助头部使用对应新名称，提供 `--version` |
| 人工执行 `pnpm exec vitest run src/cli/safe.entry.test.ts src/safe/packaging.test.ts src/safe/state.test.ts` | 用例通过；版本检查在无 Codex PATH、空临时数据目录中完成 |
| 检查 `packaging/systemd/codexui-safe.service.in` 和 `scripts/*user-service.sh` | unit 名称统一为 `codexui-safe.service`，ExecStart 为 `codexui-safe`；原密码路径、运行参数、监听策略不变 |
| 检查状态路径、环境变量、Cookie 和 localStorage 键的 diff | 无数据标识替换，无旧数据迁移逻辑 |

Windows 安装步骤见 [Windows local clone install](windows-local-clone-install.md)。实际服务安装与恢复由人工执行，参照 [tailnet service](modular-safe-cli-local-install-and-tailnet-service.md)，先人工处理旧 unit，避免抢占 5900 端口。

## 清理与回退

- 仅删除专用的 `/tmp/codexui-brand-check` 前缀及测试临时目录，不卸载现有全局包。
- 若需要回退版本，由人工恢复先前源码和安装；不要覆盖原密码、`~/.codex-mobile-safe` 或浏览器存储。
- 本检查不发布 npm 包，不使用 `npx codexui`，不创建 CI/CD 流程。
