### Feature: Direct subagent panel and reasoning summaries

#### Prerequisites
- App is running from this repository with an authenticated Codex CLI.
- A parent thread can spawn at least one collaboration subagent.

#### Steps
1. Open the parent thread on a 1440x900 desktop viewport.
2. Start or resume a turn that spawns two direct subagents.
3. Reopen a parent thread whose persisted history contains `subAgentActivity` items and verify the right-side Agents panel lists each direct agent once in activity order.
4. Verify the right-side Agents panel appears while the parent turn is running and lists newly started agents without reloading the parent thread.
5. Wait for one agent to reach a terminal status and confirm it moves to History while running or initializing agents remain in Running.
6. Select an agent and verify its task/status preview and read-only recent thread content load; load earlier messages on demand.
7. Confirm the agent detail wraps inside the sidebar without being clipped, including command output, code, changed-file diff, and collapsed Thinking summaries.
8. Drag the sidebar's left separator left and right, then focus it and repeat with Left/Right and Home/End; confirm the sidebar grows and shrinks while the parent conversation uses the remaining width.
9. Use the right column's top-right Agents control to close the entire sidebar. Confirm no rail or separator remains, the parent header, messages, terminal, queue and composer reclaim its full width, and the focused reopen button appears at the main header's top-right. Reopen it and confirm the selected agent detail is unchanged without another detail read.
10. Refresh the page and switch between parent threads, confirming the last sidebar width and collapsed state persist.
11. Confirm Fork, edit/rollback, implement-plan, and file undo/redo controls remain absent from the selected agent detail.
12. While the selected subagent is thinking, confirm only the streamed reasoning summary is shown; raw reasoning text is not rendered.
13. Switch to another parent thread, wait for the first parent's subagent to finish, then return to the first parent and confirm the terminal agent appears in History without a full thread-list reload.
14. Wait for a selected subagent to finish while its parent remains selected and confirm its detail stays open and refreshes once for the terminal result.
15. Repeat steps 6-10 at 768x1024, including a saved left sidebar width of 620px. Open the right sidebar and confirm the left sidebar collapses when both minimum widths would not fit; open the left sidebar and confirm the right sidebar collapses instead. The main column retains at least 332px without horizontal viewport overflow. At 1440px, open both and confirm their rendered widths adapt while saved width preferences remain. Start dragging the left sidebar from its actual displayed width and confirm there is no dead zone.
16. Resize to 375x812, open the Agents button at the content header's top-right, then resize back to at least 768px; confirm the sheet returns to the in-layout desktop sidebar instead of remaining teleported or disappearing.
17. Return to 375x812, open the top-right Agents button, and repeat steps 6 and 11-14 in the bottom sheet; confirm no desktop separator or desktop collapse control appears.
18. Close the mobile sheet by its close button and by tapping the backdrop.
19. Repeat the desktop and mobile checks in light and dark themes.
20. Open a parent thread with only terminal subagents and confirm the Agents entry remains available and History retains the completed tasks.
21. Open a parent whose agents occur only outside the recent history window. Use Load history and Load older collaboration; verify partial/loaded states, no duplicated agents or event IDs, and no automatic full-history scan.
22. Inspect Collaboration for spawn, sendMessage/sendInput, wait and close events, including agent-to-agent sender/receiver IDs and state messages. Confirm the parent itself is not listed as a child and no send/control actions appear.
23. Delay an agent history/detail response, switch parent threads or detail rows, then release it. Confirm no old result or stuck loading indicator appears in the new view; empty history remains viewable on mobile.
24. Select a running agent and stream assistant text interleaved with commands, plans and file changes. Confirm the response body updates before completion and replaces a stale same-ID snapshot without duplicating rows. Copy a response and verify it contains the streamed text.
25. Browse older agent pages while it continues running. Confirm latest live rows are not inserted into the older window; return to latest to see the current response. Finish the agent and confirm one terminal refresh connects to the final history without duplicate response rows.
26. Select a running agent whose latest raw turn has no displayable historical messages. Load earlier history, then load later history or jump to latest. Confirm both realtime body and the Thinking/activity overlay are absent from the older window and return only at the latest boundary.
27. While either sidebar is expanded/collapsed, expand the main composer. Confirm it fills only the main column on desktop and leaves both sidebar controls usable; repeat in light/dark themes and verify the mobile composer still uses the viewport.
28. Open an empty parent and use the main header's top-right Agents button to load collaboration history. Confirm the control remains enabled without current agents, narrow desktop space collapses the left sidebar before expansion, and closing the right sidebar does not automatically reopen the left. Resize a desktop with both sidebars open below their combined minimum width and confirm the left sidebar collapses. The toggle appears in the Agent toolbar when expanded and the main header when closed, with the same right inset.
29. Deliver an activity path, then a newer nonempty result summary with no communications, then an unknown activity or empty state message. Confirm the summary remains the row preview, terminal status is not cleared by unknown activity, and communications remain deduplicated. Load an older page and confirm it does not overwrite the newer summary.
30. Open a running child thread in the main conversation, return to its parent, and open the same child in the Agent sidebar. Stream same-ID reply, command and plan updates. Confirm the sidebar updates without duplicate rows even when restored rows exist in the main state cache. Delay the independent detail snapshot so it contains a longer reply or a newer command output cursor than the cache; confirm it is not shortened, and later current-turn deltas continue updating it. Browse an older Agent page and confirm these current-turn rows remain absent until returning to latest. Repeat on desktop and mobile.
31. Cache child reply `a`, switch to its parent and let the independent Agent snapshot contain `abc` after notifications were missed during navigation. Release that snapshot, then send delta `d`; confirm the reply becomes `abcd`, not `ad`. Repeat with an uncached child, with a child retaining a main-conversation history window, and with a 300,000-character reply that exceeds the inactive body budget. The main history reading window must remain unchanged, and later deltas must still use the snapshot prefix.
32. Delay the Agent snapshot, stream a delta or a completed replacement reply while it is pending, and release a shorter old snapshot. Confirm the newer reply survives. Start a new turn before releasing an old snapshot, or switch Agent rows/parents first; confirm the old callback does not restore an obsolete body. Repeat final-newer navigation where budget trimming leaves some turns undisplayed; no shared-baseline rebase occurs until the latest window is actually reached.

#### Expected Results
- Collaboration participants from the active parent thread are listed, including known agent-to-agent communications.
- Running lists `running` and `pendingInit`; History retains terminal and unknown statuses. Completed tasks and selected details remain accessible.
- Persisted and realtime `subAgentActivity` items populate the panel without extra thread-list requests.
- Subagent details are fetched only after their row is selected, with one refresh on transition to a terminal status. Older messages and collaboration pages load on demand.
- Desktop uses a full-height resizable right column with a default width of 480px. Closing releases the whole column with zero reserved width and shows its reopen button in the main header's top-right, opposite the left sidebar control. The main header, message area, terminal, queue and composer share the same remaining width.
- The preferred desktop width and collapsed state persist without adding requests or reloads.
- Agent detail content shrinks or scrolls within the sidebar instead of extending beyond its clipped boundary.
- Thread content is read-only and historic reasoning is collapsed by default.
- Realtime thinking displays protocol reasoning summaries only.
- Running details reuse the existing notification-fed live messages; no extra polling, history request or notification subscription is added. Merging is linear in the selected window plus its existing live rows. The agent detail remains read-only.
- Current-turn restored rows are included in the same bounded realtime view as live rows. Same-ID reply prefixes preserve the more complete body, command output uses total length or offset-plus-length cursors, and terminal command status does not regress. Historical windows and idle detail merging keep their existing isolation.
- Accepted latest Agent snapshots rebase the existing notification state, so subsequent deltas use the same prefix as the independent panel. Snapshot acceptance checks body generation and lifecycle revision, and retains updates that arrived during the read. Older or partly retained windows do not rebase the current state; main-history bodies stay frozen.
- Activity paths only fill empty previews. Nonempty result summaries replace older summaries even when the incoming snapshot has no communications; later activity or empty messages preserve the selected summary and its source.
- Completing a known direct subagent refreshes its parent state without polling or a full thread-list scan, including after switching away and back.

#### Rollback/Cleanup
- Close the mobile sheet and return to the parent thread list.
- Remove `codex-web-local.subagent-panel-width.v1` and `codex-web-local.subagent-panel-collapsed.v1` from local storage to reset desktop sidebar preferences.
- Revert the feature commit if the subagent panel is not wanted.

#### Verification Boundary
- Steps 31-32 have new mock and wiring coverage, including cached/uncached/history/oversized bases, in-flight deltas, completed replacement text and stale lifecycle/thread callbacks. These new cases have not been executed in this repair session; the older runtime results below are not evidence for this repair.
- Summary-source, full-height column, narrow-workspace and history-reading regressions have unit/wiring coverage. The continuous-sidebar and header-toggle sections below describe their separate layout acceptance checks; the following evidence describes the earlier side-conversation checks.
- Static performance review: one ResizeObserver watches the common workspace, disconnects on mobile/unmount and rebinds after Teleport mode changes. Collapsing retains the selected detail without another request. Sidebar coordination reuses the existing viewport listener and minimum-width calculations; it adds no polling or history scan. Width preferences stay intact, while explicitly opening the opposite sidebar can save a new collapsed preference.
- `pnpm exec vitest run src/composables/useThreadHistoryWindow.test.ts src/components/content/threadSubagentPanel.wiring.test.ts` passes the focused history/wiring cases, including navigation away from an empty latest turn.
- `node output/playwright/side-agent-acceptance.cjs` passes six combinations at `http://127.0.0.1:4173/#/thread/review-testchat`: 1440x1000, 768x1024 and 375x812 in light/dark themes. Mock HTTP/RPC/WebSocket events drive the real selected-Agent UI; no component props are changed to simulate the result.
- Verified live body alongside commands, no latest body/activity overlay in older history, latest restoration, one final response row, no horizontal viewport overflow and no browser page errors. Screenshots and request records are in `output/playwright/side-agent-acceptance.json`.
- Screenshot inspection found white Agent surfaces in dark mode. Theme overrides now live in `src/style.css`; reruns check both the inner surface and visible parent-panel background and produce readable desktop/mobile dark screenshots.
- The combined 238-case related mock run has 230 passes and 8 pre-existing failures reproduced on `cee6441`: two Agent-list cases and six provider-model cases. These are not classified as new regressions; report: `output/playwright/side-mock-regression.json`, baseline: `output/playwright/desktop-mock-baseline.json`.
- Performance: runtime content reuses the existing WebSocket stream; older/latest navigation is on demand, with no additional polling or subscription. Boundary detection adds one set lookup to the existing bounded-window pass. Global theme overrides add no runtime request or JavaScript work.
- Frontend/server no-emit type checks and `git diff --check` pass. No build or publication was performed. Real-model integration and long-duration browser measurements remain untested; browser contexts close after verification, and 4173 remains running.

### Feature: Continuous desktop Agent sidebar

#### Prerequisites
- Serve the current checkout on `127.0.0.1:4173`; use a parent thread with a running direct Agent.
- For Mock verification, reuse `output/playwright/side-agent-acceptance.cjs` with intercepted HTTP/RPC/WebSocket events, then run `node output/playwright/pc-agent-continuity.cjs`.
- Use 1440x1000, 768x1024 and 375x812 viewports in both light and dark themes.

#### Steps and Expected Results
1. On desktop, inspect the expanded Agent list and selected conversation. The toolbar and body share one background from top to bottom; one left divider separates the main conversation. There is no inner card outline, corner rounding, right gutter or bottom gutter.
2. Close and reopen the Agent sidebar. Its reopen button appears in the main header with the same right inset, no collapsed rail remains, and the main column reclaims the entire released width.
3. Drag the separator, then use Home/End and Left/Right. Confirm the existing width bounds still apply and these layout operations add zero thread-history requests.
4. Refresh after changing the width. Confirm the stored width remains and the rendered width matches it when there is sufficient space. At 768px, open the left sidebar, then the Agent sidebar; confirm their existing coordination keeps the main column at least 332px wide.
5. At 375x812, open and close Agents. Confirm the bottom sheet retains its rounded top corners and backdrop, with no desktop separator or collapse toolbar. Select an Agent and check its conversation is visible.
6. Open a side conversation, enter a draft, minimize and restore it. Confirm the draft remains. On desktop, drag its header and resize its corner handle; confirm both window position and size change independently of the Agent sidebar.
7. Pop the side conversation into a new window. Confirm Plan actions and the file Diff viewer work in that document, then close the popup and confirm the draft returns to the floating window.

#### Verification Results
- Focused Mock: 35/35 passed across Agent state/wiring, desktop layout, side-conversation wiring and history-window tests. Frontend `vue-tsc --noEmit` and `git diff --check` passed.
- Full Mock: 821/823 passed; the two existing failures remain the old feedback-brand subject assertion and recovered file-change timestamp assertion. This CSS repair does not touch those modules.
- The earlier continuous-surface acceptance passed all six viewport/theme combinations at `http://127.0.0.1:4173/#/thread/review-testchat`, including live Agent content, continuous desktop geometry, the previous 44px rail, width persistence, narrow-sidebar coordination and floating draft restoration. Its retained report is `output/playwright/pc-agent-continuity.json` with 18 screenshots. The current header-toggle repair supersedes that rail behavior; use the updated cases below.
- At 1440x1000 with the default 480px sidebar, the panel begins at y=56 immediately below the toolbar and reaches x=1440/y=1000. Its former 4px top, 12px right and 16px bottom gutters are removed. Its border/radius are zero; the host supplies the single 1px left divider.
- `pc-agent-floating-geometry.cjs`: floating-window pointer drag and resize passed in both themes; report: `output/playwright/pc-agent-floating-geometry.json`; two screenshots.
- `side-popup-diff-recovery.cjs`: popup Plan/Diff, correct document ownership and returning the draft passed in both themes; report: `output/playwright/side-popup-diff-recovery.json`; two screenshots. All three browser reports contain zero page errors.
- Performance: the repair changes desktop CSS only. It adds no JavaScript, observer, timer, cache or network path. Intercepted request counts confirm zero extra history reads during sidebar collapse/reopen, keyboard resize and pointer resize. Long-duration heap growth and real-model execution were not measured.

#### Rollback/Cleanup
- Close the Agent mobile sheet and any floating or popup conversation; browser contexts are closed after verification. Leave the current-checkout 4173 server running.
- Remove `codex-web-local.subagent-panel-width.v1` and `codex-web-local.subagent-panel-collapsed.v1` to reset sidebar preferences if desired.
- Revert this UI repair commit to restore the previous desktop card appearance. No conversation data or storage schema changes are involved.

### Feature: Desktop Agent sidebar closes like the left sidebar

#### Prerequisites
- Serve the current checkout on `127.0.0.1:4173` and open a parent thread with a direct Agent.
- Repeat at 1440x1000 and 768x1024 in light/dark themes; check the existing mobile flow at 375x812.
- Mock script: `node output/playwright/pc-agent-continuity.cjs`; report: `output/playwright/pc-agent-header-toggle.json`.

#### Steps and Expected Results
1. Select an Agent, then close the right sidebar. Its host has zero displayed width; its background and divider disappear. The main header, conversation, terminal and composer gain the entire previously displayed Agent width.
2. Inspect the main header's rightmost button. It uses the same size, filled/outline icons, hover and focus treatment as the left-sidebar button, with mirrored icon direction. Only one Agent toggle is visible. After closing, keyboard focus is on that button and `aria-expanded` is false.
3. Press Enter to reopen. The button returns to the Agent toolbar with `aria-expanded` true and retains focus; the selected Agent and reply remain, with zero extra detail/history reads. The expanded sidebar retains the continuous light/dark surface.
4. Change the Agent width, close it, and refresh. The closed state remains with no reserved rail. Reopen and confirm the saved width is used, limited only by available space. Opening the opposite sidebar at 768px still coordinates the two columns and preserves at least 332px for the main conversation.
5. Open a parent with no current Agents. The main header's button remains enabled and can open collaboration history. Close again without automatically reopening the left sidebar.
6. Open the mobile Agent sheet, inspect a reply, and close it. Its backdrop, rounded top corners and header entry are unchanged. On desktop, verify floating-chat drag/resize, minimize/restore and popup Plan/Diff/draft return.

#### Verification Results
- Focused Mock: 36/36 passed across Agent state/wiring, desktop layout, side-conversation wiring and history-window tests. Frontend `vue-tsc --noEmit` and `git diff --check` passed.
- Full Mock: 822/824 passed. The same existing feedback-brand subject and recovered file-change timestamp assertions remain failing; report: `output/playwright/pc-agent-header-toggle-unit.json`.
- `pc-agent-continuity.cjs`: all six viewport/theme combinations passed at `http://127.0.0.1:4173/#/thread/review-testchat`. Report: `output/playwright/pc-agent-header-toggle.json`; 30 screenshots include expanded, closed, closed-after-refresh, detail, reopened and floating states.
- The main column gains the complete displayed Agent width: 480px at 1440x1000 and 436px at 768x1024. Closed hosts measure zero width, the header toggle retains the same right inset, keyboard focus transfers, and reopening preserves the selected conversation with zero additional history reads. Resize operations also add zero history reads; width and closed-state refresh checks pass.
- `pc-agent-empty-header.cjs`: the empty-parent entry remains enabled, empty history opens, and desktop/mobile transitions work in both themes; report: `output/playwright/pc-agent-empty-header.json`; two screenshots.
- Floating pointer drag/resize and popup Plan/Diff/draft return reruns passed both themes; reports: `output/playwright/pc-agent-floating-geometry.json` and `output/playwright/side-popup-diff-recovery.json`; four screenshots. All four final browser reports contain zero page errors, and all 36 screenshot files exist.
- Initial navigation timeouts and a Vite document-save reload interrupted earlier browser attempts. Final acceptance was rerun after restoring the current-checkout server and pausing file edits; interrupted runs are not used as evidence.

#### Performance and Cleanup
- Closing hides the existing host instead of clearing or remounting the selected conversation. No new history polling, cache, event subscription or observer is introduced; user toggles add a single Vue `nextTick` for focus handoff.
- Check intercepted thread-history request counts around closing/reopening and resizing; expect zero added reads. Page refresh performs the existing initialization reads.
- Close any mobile sheet, floating chat or popup after testing. Reset the existing width/collapsed localStorage keys to restore defaults if desired. Revert this repair commit to restore the preceding 44px rail behavior; no storage migration or conversation-data changes are involved.

#### 零宽关闭的冗余清理回归

- 保留父容器的显示隐藏及已选对话，删除子容器重复的显示控制、无样式消费者的折叠类和零宽常量。原有关闭、展开、焦点转移、宽度保存及手机弹层用例继续适用。
- 重新执行 `pc-agent-continuity.cjs`：6 个视口/主题组合全部通过，30 张截图、零页面脚本异常。关闭及刷新后占位为零，展开保留已选对话；PC 开合和调整宽度新增历史请求为零。
- 空 Agent 入口、悬浮窗拖动缩放、独立窗口 Plan/Diff 各 2 组通过。截图位于 `output/playwright/`。清理代码只减少重复表达，未增加缓存、监听器或网络路径。
