### Feature: Lazy message rendering (windowed conversation)

#### Prerequisites
- App is running from this repository.
- A thread exists with more than 50 messages (send many short messages, or use a long-running session).

#### Steps — initial load window

1. Open a thread with 60+ messages.
2. Observe that the conversation list does **not** show all messages immediately — only the most recent ~50 are rendered.
3. Verify the latest messages are visible and the chat is scrolled to the bottom.
4. Confirm a "Load earlier messages" button appears at the top of the visible list.

#### Steps — scroll-triggered load

5. Scroll up slowly toward the top of the conversation list.
6. When the scroll position reaches within ~200 px of the top, verify that the previous 30 messages appear automatically above the current ones.
7. Confirm the viewport does **not** jump — the messages you were reading stay in view.
8. Repeat scrolling up to verify additional chunks load on demand.
9. Once the oldest persisted messages are reached, verify the "Load earlier messages" button disappears. The newest end may be unloaded while reading older history.

#### Steps — manual load button

10. Reload the page and open the same long thread.
11. Click "Load earlier messages" button without scrolling.
12. Verify 30 older messages are prepended and scroll position is preserved.
13. While older messages are visible, allow the active thread to receive several new messages.
14. Confirm the current reading position stays anchored and the older-message window remains bounded to 100 rendered rows.
15. Click `Jump to latest` and confirm the conversation returns to the newest bounded window and resumes following output.
16. Force a message-list shrink or rollback and confirm at least one message remains visible whenever the list is non-empty.

#### Steps — live session growth

17. Start an active Codex session (or send many messages in quick succession).
18. Let the conversation exceed 50 messages while staying scrolled to the bottom.
19. Verify the rendered count stays bounded (top of the DOM list advances as new messages arrive).
20. Scroll up and confirm "Load earlier messages" works to reveal trimmed messages.

#### Steps — rollback / message shrink

21. In a thread with a turn that can be rolled back, trigger a rollback.
22. Verify the conversation does **not** go blank — messages still render after the list shrinks.
23. Confirm `renderWindowStart` recovers gracefully and earlier messages remain accessible.

#### Expected Results
- Only ≤50 messages are in the DOM on initial load.
- Scrolling to the top (or clicking the button) reveals older messages without a viewport jump; distant rows are removed from the opposite end.
- During live output, the rendered window stays bounded; old messages are trimmed from the top while the user follows the bottom.
- After a rollback the conversation remains visible; a non-empty conversation never renders only the load control.

#### Rollback/Cleanup
- No persistent state is changed — closing or refreshing the tab resets the render window.

### 回答完成后正文自动显示与手动滚动

前提：使用可控制 HTTP/RPC/WebSocket 顺序的 Mock 环境，或准备能输出长正文及多条命令的会话。主对话、侧窗分别检查明暗主题及 1440x1000、768x1024、375x812；桌面另检查 760x900 独立侧窗。

| 操作 | 预期结果 |
| --- | --- |
| 停在最新位置，连续接收长 Markdown 增量，随后完成回答。期间不操作滚动。 | 正文保持跟随；布局增长不关闭自动跟随，不出现需要点击 `Load later messages` 才显示最终正文的情况。 |
| 在一轮中完成 60 条命令，先发送完成通知形成 `Worked`，350 ms 后才发送最终正文。 | 最终正文自动进入渲染窗口，同一消息 ID 仅一条；不需点击加载较新消息或返回最新。 |
| 流式输出期间使用向上滚轮、单指向下滑动、PageUp 或拖动滚动条查看前文，继续输出。 | 退出跟随；阅读位置保持，不被后续正文增长拉回底部。键盘翻页不被尚未产生位移的底部滚动事件取消。 |
| 手动向下滚回最新窗口底部；另点击返回最新。 | 恢复跟随。真实历史窗口继续通过原分页与显式返回最新恢复，不因布局变化解除历史保护。 |
| 在查看前文时完成回答，再主动返回最新。 | 完成通知保留手动阅读状态；返回最新后显示最终正文，原有消息顺序与分页预算保持。 |
| 在展开的长命令输出内部向上滚动，然后接收最终回复。 | 内层输出自行滚动，不误关闭整个对话的跟随；最终回复仍自动显示。 |
| 浏览较早历史时延迟返回最新请求，完成当前回答后才返回旧快照。 | 既有有效补读机制正常；恢复后正文完整、无重复，主对话及侧窗均能继续跟随。 |

已执行：相关状态、正文回收、渲染窗口及连接检查共 292 条 Mock 通过。完成正文与历史恢复的 Playwright 矩阵 48 项通过；滚轮、触摸、键盘、真实滚动条、手动回到底部、阅读期间完成和独立窗口的 70 项检查通过；内层命令输出滚动及完成正文补充检查 50 项通过。界面共 168 项通过，无页面异常。报告与截图位于 `output/playwright/completion-fixed*.json/png`、`output/playwright/completion-scroll-intent.json`、`output/playwright/completion-nested-scroll.json` 及 `output/playwright/completion-intent-*.png`。这些结果来自受控网络通知，真实 CLI 的长时间后台休眠仍需现场核对。

性能复查：新增处理只响应当前对话的输入与滚动事件，使用一个触摸坐标，不增加全量消息扫描、历史请求、轮询或缓存。内层滚动判断沿当前事件目标的父节点检查，只在存在滚动位移时读取样式；原有有界 RAF 锁底继续复用。1440 明主题下主对话三个场景的累计正文分页请求数分别为 0、0、2，侧窗分别为 1、2、6，与修复前相同。实际帧率、长时间堆内存及真实后端吞吐未测量。

清理：关闭临时侧窗、独立窗口，恢复主题及视口；无存储变更。回滚本次修复提交恢复原滚动判定。

### Feature: Long-lived conversation and command output retention

#### Prerequisites/Setup
- Use a persisted thread with at least 100 turns, including a turn with more than 30 commands and an output larger than 65,536 UTF-16 code units.
- Keep a temporary side conversation available to check that its only transcript is protected.
- Perform these checks manually in light and dark themes, including 375x812 and 768x1024 viewports. These are acceptance instructions, not recorded execution results.

#### Steps
1. Keep following a persisted thread while adding new turns. Inspect message rows and command output previews with browser developer tools.
2. Pause following and repeatedly load earlier messages. Then load newer messages to return through the same history.
3. While reading older content, produce new turns in that thread. Confirm the reading anchor does not move to the latest output.
4. Collapse a command group and an individual command. Inspect the DOM, then reopen them and switch command pages.
5. Open an oversized completed command. Page through earlier and later output; copy its complete output and compare with the source record.
6. Switch to another thread while an output page request is pending. Confirm the old response does not replace the new thread's content.
7. Simulate a failed historical request, retry it, and use Jump to latest. Confirm failed requests preserve the current reading window.
8. Visit more than three other persisted threads. Reopen the first thread and confirm its history is restored on demand.
9. Open and close a temporary side conversation; confirm ordinary cache eviction does not silently clear its transcript while it remains open.
10. Include a supplementary Unicode character across an output page boundary in both persisted and temporary conversations. Confirm adjacent pages reconstruct the original text without split characters.
11. In browser developer tools, compare retained heap after repeated thread/history navigation and garbage collection. Check that old output buffers and evicted message windows are released. Record measurements separately; this change has only been checked statically.

#### Expected Results
- Latest rendering stays at 50 message rows; history rendering stays at at most 100 rows, excluding independent approval/live overlays.
- Collapsed command contents have no output DOM. An expanded group renders at most 30 commands per page.
- Ordinary command state retains a tail preview of at most 65,536 UTF-16 code units, with explicit truncated metadata. Completed history can be read page by page; copying uses the complete source rather than the preview.
- Tail previews are materialized separately from the original output buffer. Ordinary live output is copied/truncated per 50 ms batch, with an immediate flush when the temporary combined preview reaches 131,072 code units.
- Older loaded history is replaced as the window moves, rather than accumulated. Source history and real running commands remain intact.
- Streaming code is shown without repeated syntax highlighting; completed large code blocks avoid synchronous highlighting and oversized cache entries.
- Protected temporary/unpersisted content, a single oversized turn, explicit full-copy allocations, and upstream full-item reads are documented exceptions to strict memory bounds.

#### Rollback/Cleanup
- Close output details and history panels; temporary page caches are released. No saved conversation is deleted or migrated.
- Remove only test conversations/commands intentionally created for this check. Keep existing persistent service processes running.
