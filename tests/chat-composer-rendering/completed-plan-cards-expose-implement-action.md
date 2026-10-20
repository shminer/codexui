### Completed plan cards expose implement action

#### Feature/Change Name
Completed plan cards show an `Implement plan` button that turns plan mode off and sends an implementation prompt built from the plan content.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. An existing thread contains a completed persisted plan card
3. The thread composer is available for follow-up messages

#### Steps
1. Open a thread containing a completed plan card
2. Verify the plan card shows `Implement plan` at the bottom
3. Click `Implement plan`
4. Confirm the composer thread switches back to default mode
5. Inspect the next `turn/start` request or the resulting assistant behavior

#### Expected Results
- Completed plan cards render the `Implement plan` action even when the plan body is structured as headings/lists instead of checkbox steps
- Clicking the button sends a simple implementation follow-up message instead of copying the whole plan body into chat
- The next turn runs in default mode rather than plan mode

#### Rollback/Cleanup
- Archive or delete any test thread created only for this check

---

### 完成后的 Plan 无需刷新即可显示

变更：实时 `item/completed` 的 `plan` 条目与历史读取共用规范化；增量优先使用真实 `itemId`，无 ID 的临时草稿在最终条目到达时合并。回合结束前将 Plan 保留到有界消息窗口，避免清理临时状态时丢失正文。空的最终通知不覆盖已收到的正文；中断的草稿保留未完成状态。

前提：当前仓库的 Vite 服务运行于 `http://127.0.0.1:4173`，已安装 Playwright Chromium。运行 `node scripts/test-plan-realtime.cjs`。Windows dev wrapper 若报 `spawnSync vite.cmd EINVAL`，使用 `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173`。脚本挂载真实 `useDesktopState`、RPC 通知客户端和 `ThreadConversation`，拦截 WebSocket／HTTP，所有消息为隔离测试数据。

| 操作 | 预期 |
| --- | --- |
| 开启 Plan 回合，发送 `item/plan/delta`，再发送包含完整正文的 `item/completed`。 | 增量正文变成完整 Plan 卡片，出现 Implement plan，未完成标记消失；无需刷新。 |
| 不发送增量，只发送完整 Plan 条目。 | 最终正文立即出现，不能因缺少增量而漏掉。 |
| 回合完成后故意让历史读取失败／返回旧快照。 | 已有 Plan 仍可见，不闪失、不重复；恢复历史时按同一条目 ID 合并。 |
| 开始下一轮。 | 上一轮已完成 Plan 保留，不随临时计划清理消失。 |
| 增量没有 itemId，最终条目带真实 ID；另有 turn/plan/updated 任务清单。 | 临时文本草稿被真实条目替换；任务清单不被误删。 |
| 最终条目正文为空，或回合被中断。 | 空文本不抹掉已收到的正文；中断草稿不被误标完成。 |
| 检查主对话虚拟列表 1440×1000 和侧窗共用的普通列表 375×812，切换明暗主题。 | 卡片和正文完整，按钮可见，深色背景正确。实际侧窗状态路径另由单元测试覆盖。 |

自动化结果：8 个消息状态回归用例通过（含未选中线程的后台完成）；最初的 4 个关键用例在修改前均失败，修改后通过。浏览器经真实 WebSocket 通知处理，在故意返回历史 HTTP 503 的条件下仍保持唯一 Plan 卡片并显示操作按钮；下一轮开始后卡片保留。测试 URL 为 `http://127.0.0.1:4173/__plan-test?mode=main` / `?mode=flow`，截图为 `output/playwright/plan-realtime-{main,flow}-{light,dark}.png`，数据为 `output/playwright/plan-realtime-results.json`。截图中的红色 503 是注入的补读失败，正用于证明正文不依赖补读。

性能审查：最终通知到卡片可见，本机主对话约 62ms、普通列表约 27ms。修复只在现有有界消息数组中合并、去重；最终 Plan 复用现有解析，未增加请求、监听器、轮询或全历史载荷。两种模式测试各记录 11 个既有生命周期请求，包括 5 次队列状态读取和 2 次失败后的最近历史读取；Plan 完成处理自身不发请求。未测真实模型服务延迟及长期内存。

工程验证：类型检查、`pnpm run build`、`codexui --help`、`codexui-safe doctor`、`git diff --check` 通过；全量测试为 901 通过／19 失败／6 跳过，另一个套件因 Windows 调用 pnpm 的 ENOENT 失败，失败名称与上轮基线一致。本机未安装 Docker，未运行 provider/auth 容器矩阵；未完成 Android 真机及 Linux 实机复测。

清理／回滚：脚本卸载组件、停止通知订阅并关闭隔离上下文，不写真实会话。4173 保持运行；产物位于忽略目录 `output/playwright/`。仅回滚本次实时 Plan 修复提交并重新构建即可恢复旧行为，不涉及配置或数据迁移。
