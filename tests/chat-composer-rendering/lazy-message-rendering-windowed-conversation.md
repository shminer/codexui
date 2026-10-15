### 功能：稳定历史缓存与动态高度虚拟列表

本轮状态：仅完成静态／类型检查；下列 Mock、浏览器和真实会话用例待运行。下方既有截图、请求数和测试通过数属于此前提交，不代表本轮虚拟列表的验收结果。

前提：准备超过 100 轮、包含代码块、图片、表格、折叠命令和超长单轮的可控会话。主对话、侧窗、子 Agent、归档共用以下用例；主对话与侧窗另检查搜索定位和独立窗口。使用 1440x1000、768x1024、375x812，覆盖明暗主题及中英文。

| 操作 | 预期 |
| --- | --- |
| 打开会话并停在最新位置。 | 初次请求最近 20 轮；仅挂载视口和上下各 400px 缓冲区内的动态高度行。正文不按 50／30／100 条移动窗口。 |
| 向上抵达已加载边界一次，或点击加载更早消息。 | 请求相邻 10 轮，整轮 prepend；首个可见消息 ID 和相对位置保持，不删除已加载的较新端。 |
| 在已加载范围内上下滚动，多次回到底部。 | 正文集合保持；无新内容时不回收，不额外请求历史。虚拟行随视口挂载／回收。 |
| 用一页高度变化很大的内容触发 prepend，再停止输入。 | 布局补偿不连读，不触发反方向请求；每次抵达边界至多一笔自动分页。短页面仍可点按钮继续。 |
| 展开命令、加载图片、切换代码块折叠状态。 | ResizeObserver 更新行高；阅读位置不异常跳转，最新位置仍跟随输出。 |
| 阅读历史时流式产生新正文，再完成该轮。 | 保持阅读位置，显示新内容／返回最新入口；重复完成通知不裁历史。 |
| 无新内容时重复静默同步、普通返回最新。 | 已加载历史保留；不因滚动到下方、重复快照而移除较早端。 |
| 有实际新内容后返回最新，再继续完成新轮。 | 显示最新内容；在快照／完成边界收敛到正常 20 轮、2 MiB 预算，保留活跃轮及待处理内容。 |
| 加载历史至估算 16 MiB 或 1000 条。 | 保留已加载集合，暂停继续接纳，显示容量提示；相邻一轮放不下时停在它之前，不跳过，不把另一端挤掉。 |
| 点击“释放历史并返回最新”，先失败再重试成功。 | 失败不变更窗口；成功后才释放历史并恢复最新预算和跟随。 |
| 搜索旧消息；切到独立侧窗再移回。 | 按稳定消息 ID 转换为虚拟索引定位；文档切换重建测量环境，以消息 ID 和偏移恢复阅读位置。 |
| 回滚使消息变少；切会话；最小化侧窗后恢复。 | 非空会话正常显示；切换重置测量缓存；既有非活跃／最小化预算、草稿与队列保护仍有效。 |

清理：关闭测试侧窗和独立窗口，恢复主题、语言及视口；只删除专门建立的测试会话。本次无存储格式迁移，源码回滚恢复原分页实现。

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
- Rendering follows the viewport plus a 400px buffer on each side, using measured dynamic row heights; loaded history remains independent of mounted rows.
- Collapsed command contents have no output DOM. An expanded group renders at most 30 commands per page.
- Ordinary command state retains a tail preview of at most 65,536 UTF-16 code units, with explicit truncated metadata. Completed history can be read page by page; copying uses the complete source rather than the preview.
- Tail previews are materialized separately from the original output buffer. Ordinary live output is copied/truncated per 50 ms batch, with an immediate flush when the temporary combined preview reaches 131,072 code units.
- Loaded older history is kept until new content is followed, explicit release succeeds, or the thread becomes inactive. Historical admission pauses at 16 MiB estimated text or 1000 messages without evicting the opposite end.
- Streaming code is shown without repeated syntax highlighting; completed large code blocks avoid synchronous highlighting and oversized cache entries.
- Protected temporary/unpersisted content, a single oversized turn, explicit full-copy allocations, and upstream full-item reads are documented exceptions to strict memory bounds.

#### Rollback/Cleanup
- Close output details and history panels; temporary page caches are released. No saved conversation is deleted or migrated.
- Remove only test conversations/commands intentionally created for this check. Keep existing persistent service processes running.
