# Side conversation `/btw` mobile sheet and desktop window

## Feature / Change

The composer voice-input control is replaced by a temporary side-conversation button. A side conversation snapshots the parent thread model and Thinking value when it is created, remains scoped to the current main thread, survives minimization, and ends from X or when the original page closes. Its transcript uses bounded browser memory and temporary server memory; draft, selections, completion statistics, and queue remain in browser memory. Pop-out moves the same instance into a new window; it depends on the original page remaining open.

## Prerequisites

- Start the app from this repository with a Codex CLI version that supports ephemeral `thread/fork`, `thread/inject_items`, `turn/interrupt`, and `thread/unsubscribe`.
- Open a persisted thread that already contains at least one completed user turn.
- Keep the thread list and browser DevTools Network panel visible when checking RPC behavior.
- Prepare desktop and mobile-sized viewports, plus both light and dark app themes.

## Desktop Floating Window

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Open an existing thread on a desktop viewport. | The composer action row shows the side-conversation icon, and Settings contains no controls for the removed input feature. |
| 2 | Click the side-conversation icon. | One floating window opens at the current lower-right default size and position without blocking the main conversation. Its header shows pop-out, minimize and X controls. |
| 3 | Open the side window before a newly selected parent finishes restoring, then inspect RPC requests. | The app waits for the parent restore, then sends `config/read`, `thread/fork`, and `thread/inject_items`. The fork uses the restored parent model, runtime provider ID, Thinking value, `ephemeral: true`, and `excludeTurns: true`; it does not send `persistExtendedHistory` or the unsupported `sideConversation` field. |
| 4 | Send a side question and wait for the response. | The side transcript starts empty and renders only this side turn, including its message times, live activity, commands, file changes, and final response. The model can still use the parent conversation as context, but inherited parent turns never appear in the side window. The main transcript and composer draft remain unchanged. |
| 4a | While the side model is thinking, choose Steer and send another message; then choose Queue and send one more. | The live activity stays before steering in its own turn. Confirmed rows follow server window order; steering is not moved after later turns. The queued message stays in the side queue until its turn starts, without appearing in the main transcript or sending a second immediate `turn/start`. |
| 4b | In the side composer, choose a model, Thinking level, mode, and skill, then send. | The side turn uses those selections. Changes do not alter the main composer selection; the side composer shows no nested side-conversation button. |
| 4c | Type a draft, select a skill and attachment, then receive and answer an approval or user-input request. | The composer hides during the request and restores the same draft, skill and attachment afterward. |
| 4d | Queue two messages, then edit a main-chat queue or trigger a main-chat refresh. Complete the side turn, deliver a repeated completion notification, and interrupt the next side turn. | Main-chat operations neither save nor erase the side queue. Successful completion starts exactly one queued message. Duplicate completion starts no extra turn; interruption leaves remaining queued messages intact. |
| 4e | Send Steer during live output, then allow the server to confirm the user item and finish the turn. Start another side turn. | The confirmed steer keeps its server position within the original turn, without duplication or moving below later turns. New live activity does not appear before the old turn's steering. |
| 5 | Disable `Send with Enter`, type a question, press Enter, then press Command+Enter or Ctrl+Enter. Re-enable the setting and repeat with Enter and Shift+Enter, including while an IME candidate is active. While a side turn runs with Queue selected, use the modifier shortcut with a draft, then with an empty composer and two queued messages. | The side composer follows the same global shortcut as the main composer: plain Enter inserts a line when disabled, the platform modifier always Steers the current draft, plain Enter sends with the selected mode when enabled, Shift+Enter inserts a line, and IME confirmation never submits. With an empty composer the shortcut Steers only the first queued message. |
| 6 | Briefly disconnect the upstream API while a side response is running, then allow its normal retry to recover. | The side window shows the reconnect state, clears it on the next side event, and continues the same side conversation. |
| 7 | Switch between light and dark themes. | The panel, header, input, buttons, error surface, and message area remain readable with no light surface left on the dark page. |
| 8 | Switch to another main thread or return to the home page. | The side window closes immediately and the side child is interrupted when active, then unsubscribed in the background. The new main thread stays selected. |
| 9 | Drag the desktop header, then resize from the lower-right handle toward both minimum and viewport limits. Tab to the resize handle and repeat with the four arrow keys. | Pointer and keyboard resizing keep the window inside the visual viewport, expose the current size to assistive technology, and reflow the transcript and composer without overlap. |

## Mobile Bottom Sheet

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Repeat the flow at `375x812`. | The side conversation opens as a bottom sheet with a backdrop, a visible decorative handle, stable full width, no desktop resize handle, and no text or controls outside the viewport. |
| 2 | Enter a multiline question with `Shift+Enter`, then send it. | The input grows only within its bound, the sheet does not shift width, and the message is sent once. |
| 3 | Open the mobile keyboard and receive a long response. | The message list remains scrollable, the input and action button remain reachable, and content does not overlap the minimize or X controls. |
| 4 | Verify both light and dark themes. | The bottom sheet and backdrop preserve contrast and all controls remain visible. |
| 5 | In a mobile browser at `375x812`, type a draft and queue a message, then open the side chat in a new window. Inspect model, skills and Thinking menus, send, then close the new tab. Repeat in dark theme. | The new tab uses the device-width viewport and fills the screen without desktop-page shrinking or horizontal scrolling. Menus fit the mobile viewport; selections and sending work, and closing returns the same draft and queue to the original page. |

## Minimize And Cleanup

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | While a side response is running, click minimize or the mobile backdrop. | The window hides without interrupting or unsubscribing the child; the response continues in memory. |
| 2 | Click the side-conversation icon after minimizing. | The same child, transcript, draft, selected model and skills, queue, response state, desktop size, and desktop position return without another `thread/fork`. |
| 3 | While a side response is running, click X. | The UI clears immediately, rejects pending requests, interrupts after a pending `turn/start` returns its ID, then unsubscribes the child in the background. |
| 4 | Open an idle side conversation and click X. | The UI clears immediately, sends `thread/unsubscribe`, and does not send an empty `turn/interrupt` or `thread/archive`; reopening creates a new empty child. |
| 5 | Refresh while the side window is open, including immediately after sending a message. | The page sends one best-effort keepalive discard request. The server reads the current active turn, interrupts it when present, then unsubscribes in order. After reload, no child ID, transcript, draft, model, or Thinking state is restored. |
| 6 | Switch to another main thread or account after opening a side conversation. | The side conversation ends, and reopening creates a new empty ephemeral child. |
| 7 | Inspect the main thread list before and after closing or refreshing. | The ephemeral child never appears in the persistent thread list. |

## Pop-out Window

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | With a draft and queue present, click Open in new window in the header. | The same transcript, live turn, draft and queue move into a full-window view; no extra fork, resume, notification subscription, or storage write occurs. |
| 2 | Select a model and skill in the popped-out composer, send a message, then switch the original page theme. | Menus appear and respond in the popup. The payload includes the selections; both documents use the same theme. |
| 3 | Close or refresh the popup. | The same instance returns to the original page with its draft and queue intact. |
| 4 | End the side conversation or close/refresh the original page while popped out. | The temporary conversation ends. Ending it closes the popup, and refreshing the original page restores no side state. |
| 5 | Block popups and click Open in new window. | The original side conversation stays usable with its draft and queue intact. |

## Rollback / Cleanup

- Close any side window created during the check.
- Confirm no temporary side child is visible in the thread list after cleanup completes.
- Return the viewport and app theme to their previous settings.

## Shared Chat Width And Edit Message

- Setup: open a parent thread and side conversation; prepare light/dark themes and desktop/mobile viewports.
- Adjust Settings > Chat width while the floating side window is open, then pop it out and adjust again. Minimize and restore; reload the parent, reopen a side conversation, and repeat.
- Expected: transcript, user bubbles and composer share the main width preference, constrained by the available window. The outer floating window still resizes independently.
- Click Edit message on a side user message with an empty draft and with an existing draft. Repeat while a response runs and in the popup.
- Expected: text is appended to the side draft and focused; main draft and historical messages are unchanged. Existing attachments, skills and queue remain. No rollback or automatic send occurs.
- During opening or a pending approval/input request, the edit action is absent. Agent and archived read-only previews still have no edit action, and side Fork/file undo controls remain absent.
- Cleanup: close the side conversation and restore the width preference. Mock browser checks cover shared width, post-refresh persistence and independent side-message editing; popup-specific checks remain manual.

### Ephemeral synchronization regression

- Setup: current CLI with ephemeral forks; open a parent conversation and the browser network inspector.
- Send two side turns, steer during the first, and reconnect the notification stream. Finish or stop the turn, then start another.
- Expected: lifecycle synchronization uses `thread/read` with `includeTurns:false`, never `thread/resume` or native full history. Transcript pages use `/codex-api/thread-turn-page?source=ephemeral` and read only the temporary server cache. No `no rollout found` or `ephemeral threads do not support includeTurns` error. A lost runtime thread asks to reopen the temporary conversation.
- Close the side window or reload the parent. Expected: the active turn is interrupted when its ID is known, then the child is unsubscribed. No transcript or side queue is saved. Empty side queues trigger no background history reads/retry timers.
- Cleanup: close the temporary child; no persistent test session is needed.
- Performance: one metadata read per coalesced lifecycle sync, one coalesced temporary-cache read on visible completion/restoration, and no history polling for minimized threads. No live long-duration throughput measurement was performed.

- Reorder fixture delivery so idle metadata precedes the final assistant item, and so running metadata arrives after turn completion. Expected: one final reply, no restored Thinking state. Replay of a final item updates the same in-memory ID. Each render deduplicates side rows in linear time; no extra request is needed.

- Reload while `turn/start` is pending: teardown waits for the server-side start to settle and uses its active turn ID before unsubscribing. This adds no history read and does not rely on the departing browser receiving the start response.

## Temporary Server History Cache

| Item | Actions | Expected result |
| --- | --- | --- |
| Setup | Use an ephemeral-capable CLI; open a side conversation and DevTools Network. | The child stays absent from persistent history and the cache contains only new child turns, not inherited parent turns or boundary injection. |
| Paging | Produce at least 25 side turns, request earlier/later/latest pages with `source=ephemeral`. | Exclusive turn anchors page the same child; these routes issue no native history RPC. |
| Limits | Produce over 100 turns, more than 8 MiB of retained source data, or exceed the global 32 MiB cache budget across tabs. | Older turns/items or least-recently-used caches are released. Expired sources return 410; evicted anchors return 409. A single oversize item is omitted rather than retained beyond budget. |
| Expiration | Leave a child idle without cache reads for 30 minutes. Resume with a new turn. | The old cache expires; the new turn creates a fresh bounded cache marked as truncated. Later child events never enter the ordinary persisted-item cache. |
| Policy | Deny `thread/read` for page requests and `thread/items/list` for source requests using the injected policy. | Requests return 403 before reading the cache, preserving the existing route/RPC checks. |
| Cleanup | End the side conversation; deliver a late completed-item event. | Cache and active registration are released; recent closed-child events are ignored. Process disposal clears all temporary caches. Up to eight live temporary children are admitted per app-server process. |

## Browser Transcript Budget And Minimize

| Item | Actions | Expected result |
| --- | --- | --- |
| Setup | Prepare desktop, 375x812 and 768x1024 viewports; repeat in light/dark themes. Generate over 20 turns, a response over 256 Ki characters and command output over 64 Ki characters. | Side assistant text, command output and reasoning deltas use the existing 50 ms batch path; completion/idle synchronization flushes pending content first. |
| Retention | Continue sending while observing browser state and heap snapshots. Include a single turn with many commands. | Visible transcript retains at most 20 turns, 1000 items and an estimated 2 MiB text budget including live content and reasoning. A single huge turn is cropped by item, not exempted. |
| Output | Expand a long completed command; page earlier/later output and copy full output. | State stores only the latest 64 Ki characters plus offset/total metadata. Older output and full copy read the temporary source only when requested. |
| Text | Edit/copy a truncated user message and copy a truncated assistant response. Then expire the source and repeat. | A truncated marker is shown. Successful actions use the full source; an expired/running source shows an error without editing the draft or copying the preview as full content. |
| Minimize | Keep a draft, skill, attachment and queued messages; minimize while running. | Only the transcript component unmounts. Its render caches/timers are cleared. Browser transcript drops to 10 turns and an estimated 512 KiB budget; draft, queue, selections and child execution remain. |
| Restore | Open the same side window, then pop it out and return. | Same child, no fork/resume/new subscription; restoration at the latest position coalesces one latest-cache read. Restoration in a history window keeps the retained window and makes no automatic latest read. Width preference stays synchronized. |
| Reading restore | Page into older temporary history, minimize and restore while the same child continues running; then click Jump to latest. Repeat with a failed latest read and in the popup/mobile sheet. | Restoring the transcript component does not itself force latest or activate bottom following in an existing history window. A failed latest read preserves the remaining preview and history state; successful explicit Jump resumes following once. |
| Races | Delay a history request; finish another turn or close the side window before returning the response. | Newly arrived rows survive the delayed response; closed state stays cleared. Stale anchors recover latest once, and expired caches stop pagination while keeping the remaining preview. |
| Cleanup | End the child and restore viewport/theme/width settings. | Pending deltas, window bounds, indices, queue and cache references are released. No side transcript/draft is persisted in localStorage. |

Server source budgets are additional to the existing ordinary-thread cache budget; draft/attachment/queue memory is intentionally outside transcript retention.

## Mock And Browser Verification

| Check | Execution / Evidence | Result |
| --- | --- | --- |
| Mock regression | `pnpm exec vitest run` for the temporary server cache, bridge memory, gateway paging, ephemeral window, desktop state, history window, copy controller and conversation wiring/window modules. Report: `output/playwright/side-mock-regression.json`. | 238 cases: 230 passed, 8 failed. All 8 failures reproduce on pre-change commit `cee6441`; they cover two Agent-list expectations and six provider-model cases. No new failures. |
| Focused side state | `pnpm exec vitest run src/composables/useDesktopState.test.ts -t 'side conversation lifecycle\|side memory event races\|bounded thread working sets\|recent thread preview\|turn completion ownership'`. | 70 passed. Gateway implementations and one-shot responses are reset between cases; default asynchronous history responses are explicit. |
| Main UI | `node output/playwright/side-agent-acceptance.cjs`, using `http://127.0.0.1:4173/#/thread/review-testchat`, mocked RPC/HTTP/WebSocket events, and 1440x1000, 768x1024, 375x812 in both themes. | Six combinations passed; 12 screenshots. Independent drafts, live body, 64 Ki command preview and earlier-source paging, full-source edit of a 270000-character user message, transcript unmount, same-child restoration and older temporary history passed. |
| Retention UI | `node output/playwright/side-extra-acceptance.cjs`; desktop/mobile in both themes. Report: `output/playwright/side-extra-acceptance.json`. | Four combinations passed; four screenshots. Width survives reload, side width matches the setting, draft/skill/queue survive minimization, execution continues, 410 preserves remaining content, and closing unsubscribes once without archive. No side ID is saved in localStorage. |
| Request counts | Inspect the main/extra acceptance reports. | One fork; no side resume; no temporary-history request while minimized; one latest-page request on restore. Complete source/command-page reads occur only on user action. |
| Short pressure check | `node output/playwright/side-memory-stress.cjs`; 200 deltas and 420 completed mock turns with 100000-character command output each. Report: `output/playwright/side-memory-stress.json`. | 200 deltas produced 3 DOM mutation batches. Minimized state retained 4 turns, 8 items and 212726 text characters; command previews stayed at 65536 characters. Latest content remained present, transcript DOM stayed unmounted, and minimized history requests were zero. |
| Heap / blocking | Chromium CDP forced-GC samples in the pressure report. | Last two samples: 11978496 and 11985180 bytes; one recorded long task of 59 ms. This is a short development-mode fixture check, not a production leak proof or long-duration soak. |
| Static checks | `pnpm exec vue-tsc --noEmit`, `pnpm exec tsc --noEmit -p tsconfig.server.json`, `git diff --check`. | Passed. No build, package install or publish was executed. |

The browser scripts intercept writes and model turns; no real model task is started. Each browser context closes after the check, leaving the existing 4173 server running. Live CLI integration, popup/attachment-specific interaction, native mobile keyboards and a long-duration production heap profile remain untested.

## Feature: Side Plan Implementation And Main-Chat Interaction Parity

Prerequisites: use a parent thread with an available Plan model and temporary side conversation; prepare mock RPC/WebSocket events, delayed history responses and rejected send requests. Repeat the UI cases at 1440x1000, 768x1024 and 375x812, in light/dark themes and Chinese/English.

| Action | Expected result |
| --- | --- |
| Generate a completed side Plan, click Implement plan twice while delaying `turn/start`. | One `Implement` request targets the side thread in Default mode. The main mode, draft and transcript stay unchanged. Streaming plans and read-only agent details have no implementation action. The label reads 实施计划 in Chinese. |
| Send multiple steering messages across two turns, confirm them through temporary history, then repeat the latest read. | Server order is retained, each ID appears once, and old steering remains within its original turn. The live overlay only precedes current-turn steering. |
| Delay a latest read, update an older same-ID body, and start a newer turn before releasing the response. Include command output and a completed plan replacing a live plan. | Changed older content stays before newer turns, newer text/output survives, and the completed plan is not replaced by a stale live record during retention. |
| After a latest snapshot absorbs a running body, command and plan, deliver another delta for each. | Each delta continues the retained prefix rather than replacing it with only the latest fragment; IDs remain unique and truncation limits remain active. |
| Load older history, then send or implement a plan. Repeat while an older read is still pending and with a failing latest read. | Sending waits for one latest read, releases history mode, and resumes following only after success. A failed latest read retains history and starts no turn. |
| Read older history, minimize and restore. | The retained history stays visible; restoration alone performs no latest read. Explicit Jump to latest resumes current content. |
| Delay a speed setting save, attempt to send, and complete a side turn with another message queued. | Direct sending and implementation are blocked during the save. The queued message stays available and starts once after the save settles. |
| Reject a normal send, then reject a steering send during an existing turn. | Only the failed optimistic row is removed. Its complete payload is retained in the side queue for editing or retry; the error is visible, and an existing active turn and its content remain. |
| Pop out the side conversation. Enter free-text user-input and approval answers, use a file-link context menu, open a Diff, copy a response/code block/full command output, and return to the main page. | Inputs are submitted accurately; menu events, Diff and copy fallback belong to the popup document. Returning cleans the old window listeners and preserves the same draft and queue. |
| End the side conversation while a read or implementation request is pending, then release the old result. | Closed state is not recreated; a newly opened side conversation is not modified by the old result. |

Cleanup: end the side conversation, close remaining popups and restore theme/language/speed/viewport settings. Revert the repair commit to roll back these changes; no data migration is involved.

Verification at commit `ccda6cc`, before the follow-up below: new mock and wiring regressions were prepared but had not run. Earlier evidence above predates that commit. Static performance review confirmed bounded snapshot merging with Map/Set, unchanged retention budgets, one coalesced latest read after an in-flight older read, and cleanup of document-owned listeners. Browser verification for the follow-up is recorded below; long-duration heap growth remains unmeasured.

Static checks at `ccda6cc`: `pnpm exec vue-tsc --noEmit`, `pnpm exec tsc --noEmit -p tsconfig.server.json` and `git diff --check` passed. No build, runtime tests or publication was executed at that stage. The follow-up explicitly authorizes Mock and browser testing.

## Feature: Failed Side Sends And Queue Recovery

Prerequisites: open a parent thread and side conversation with mocked RPC/HTTP/WebSocket traffic. Prepare rejected `turn/start` responses and failed latest-window reads. Use 1440x1000, 768x1024 and 375x812 viewports in light/dark themes. Mock traffic must not start real model tasks.

| Exact action | Expected result |
| --- | --- |
| Select a skill and attach an image/file; submit a side message while `turn/start` is delayed, type a new draft, then reject the request. | The failed optimistic row disappears. The complete original text, images, files, skills and collaboration mode remain in one side queue row. The newer draft and main-chat draft stay unchanged. |
| Click Steer on that queue row, reject the retry, then allow another retry to succeed. | Failure restores the same queue ID and position. Success sends the original payload once and removes that row. Other queued messages retain their order. |
| Queue a message during an active side turn, load earlier history, fail latest-window reads, then deliver successful completion of the active turn. | One latest read fails; no new turn starts. The queued message returns at its original position, and the history window remains visible. |
| Restore latest-window reads and click Steer on the retained row. | One latest read completes before one turn starts. History mode releases, the latest content becomes visible, and the existing draft stays unchanged. |
| Start a speed-setting save while sending is waiting for latest history, then release the read and finish the speed save. Repeat with a failed speed save. | No turn starts during the save. The payload retains its original queue ID and starts once after either save result. |
| End the side conversation while a queued send is pending, open a replacement, then reject the old send. | No old payload, error or queue row is restored into the replacement. |
| Pop out a completed side Plan with changed-file metadata, open its Diff, close the Diff, then close the popup. | Implement plan remains visible. The Diff mounts only in the popup document, its close button works, and the side draft returns to the original page. Dark theme has no white Diff surface. |

Browser commands: `node output/playwright/side-send-recovery.cjs`, `node output/playwright/side-agent-acceptance.cjs`, and `node output/playwright/side-popup-diff-recovery.cjs`. These use `http://127.0.0.1:4173/#/thread/review-testchat` and the current worktree's existing verification server.

Browser results: all 14 groups passed with zero page errors. Six recovery groups produced 18 screenshots; six existing side/agent groups produced 12 screenshots; two popup Diff groups produced two screenshots. Each recovery group used one fork, two rejected turn-start attempts and two successful starts; history failure and explicit retry each made one latest read. Reports are under `output/playwright/side-send-recovery.json`, `side-agent-acceptance.json` and `side-popup-diff-recovery.json`.

Mock/static results: `pnpm exec vitest run --reporter=json --outputFile=/tmp/codexui-side-retry-all.json` ran 823 cases: 821 passed and two pre-existing failures remained (feedback subject brand and session file-change fallback timestamp). All 246 desktop-state cases and the popup-aware Diff wiring case passed. `pnpm exec vue-tsc --noEmit` and `git diff --check` passed. No build or publication was performed.

Performance review: queue restoration scans only the existing side queue and runs on enqueue/error paths, outside streaming delta rendering. Retry preserves original IDs and payload references without transcript duplication. No new history request path, global refresh, timer or background retry loop is added. Browser checks confirm bounded request counts; long-duration heap growth was not measured in this repair.

Cleanup: close side windows and mock browser contexts, restore theme/viewport selections, and leave the current 4173 verification server running. Revert the repair commit to roll back; no storage migration is required. Browser artifacts remain local under `output/playwright/`.

## 功能：侧窗速度保存竞态与 409 回退请求复用

前提：使用当前工作目录的 4173 服务和 Mock HTTP/RPC/WebSocket。打开父会话及侧窗，准备可以延迟或拒绝的速度保存、分页及最新历史读取请求。PC、平板、手机分别使用 1440x1000、768x1024、375x812，检查明暗主题。

| 精确操作 | 预期结果 |
| --- | --- |
| 侧窗发送第一条消息并排队下一条；加载较早历史；通知第一轮完成，暂停自动发送触发的 latest 读取；开始保存速度配置，再释放 latest，最后结束速度保存。分别让速度保存成功和失败。 | 保存期间不发送；重新入队保留原 ID 和位置；保存结束后下一条恰好发送一次，队列清空。 |
| 延迟普通侧窗发送；开始保存速度配置；拒绝发送，再结束速度保存。 | 失败消息及错误保留，等待用户显式重试；速度保存结束不自动重试失败请求。 |
| 延迟 older 或 newer 读取；在 409 返回前请求 latest，再令分页返回 409，最后释放回退 latest。另一组先令分页返回 409，在回退 latest 等待期间请求 latest。 | 四种组合均只读取一次 latest；等待者共享成功回退结果，窗口恢复到最新，消息无重复。 |
| 分页返回 409，回退 latest 延迟且最终失败；同时请求 latest，允许重试成功。 | 原分页调用收到失败；等待者补读一次最新窗口并恢复，错误清除。失败结果不当作已恢复最新。 |
| 正常 older 读取等待期间请求 latest；分别释放两次读取。 | 原有较早分页仍保留方向；随后读取一次 latest，不把普通历史窗口当成最新窗口。 |

Mock 回归位于 `src/composables/useDesktopState.test.ts`；请求数量使用调用次数断言。侧栏关闭、刷新恢复、悬浮窗口使用既有 `output/playwright/pc-agent-continuity.cjs`，侧窗发送恢复使用 `output/playwright/side-send-recovery.cjs`。

清理：结束侧窗和弹出窗口，恢复速度、主题、视口设置；验收服务 4173 保留运行。回滚对应修复提交即可恢复代码，无存储迁移。

验证结果：新增 8 条回归；修复前 6 条失败、2 条通过，修复后相关 6 个测试文件共 290/290 通过。全量 Mock 为 830/832 通过，剩余两项与修复前基线一致：反馈邮件品牌断言、恢复文件变更时间戳。报告：`output/playwright/fix-side-races-unit.json`。`vue-tsc --noEmit` 和 `git diff --check` 通过，未执行构建或发布。

界面回归：侧栏 6 组、侧窗发送恢复 6 组、独立窗口 2 组、悬浮窗拖动缩放 2 组、空 Agent 入口 2 组，共 18 组通过、54 张截图，五份报告均为零页面脚本异常。对应报告：`pc-agent-header-toggle.json`、`side-send-recovery.json`、`side-popup-diff-recovery.json`、`pc-agent-floating-geometry.json`、`pc-agent-empty-header.json`，均位于 `output/playwright/`。

性能复查：成功的 409 回退在四种竞态组合中均只请求一次 latest；失败回退才触发等待者补读。协调状态仅保留当前侧窗读取的一个标记对象，随原读取锁清理，不增加轮询、订阅、全量历史或全会话刷新。速度续发复用原队列，没有后台无限重试。长期真实会话的堆内存和帧率未测量。
