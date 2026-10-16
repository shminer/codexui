### Feature: Keep manual chat scroll position during streaming

#### Prerequisites
- App is running from this repository.
- A thread exists with enough history to allow scrolling away from bottom.

#### Steps
1. Open the thread and scroll upward so latest messages are not visible.
2. Send a new message that produces a streaming assistant response.
3. During streaming, do not scroll and observe viewport position.
4. After streaming completes, verify the viewport remains at the same manual position.
5. Page back far enough to enter a retained history window, then trigger a same-thread wake/reconnect or background refresh. Verify the reading anchor and visible window remain unchanged, and no implicit latest-page request occurs.
6. Click Jump to latest with a delayed response, then a failed response. Verify history, search target and anchor are preserved until success; retry and confirm following resumes only after latest loading succeeds.
7. Move to the final newer page when its last turn exceeds the text budget. Verify any omitted newer content still exposes a later/latest path instead of incorrectly enabling bottom following.
8. Repeat in a read-only Agent detail and archived conversation. Verify there are no edit, fork, rollback or send controls, and older/latest paging remains available.

#### Expected Results
- Streaming updates do not force auto-scroll to the bottom when user has manually scrolled away.
- User can continue reading older history while the response streams.
- If the thread is already at the bottom when streaming starts, the latest streaming overlay remains visible.
- If a row height arrives after the initial bottom-lock frames, latest following resumes from the measured geometry. When the reader has scrolled upward or unread newer history exists, row measurement preserves reading protection instead.
- History/newer flags stop bottom locking immediately. Clearing those flags in a same-thread background update does not independently turn following back on.
- Scrolling inside the loaded virtual list does not request history or evict body content. Ordinary return to latest preserves expanded history when no new content exists; new content automatically releases older history after the reader follows latest. A failed latest read preserves the window. Capacity only disables paging; no capacity notice or manual clear-history action is shown.

#### Verification Boundary
- The 2026-10-16 side-layout Mock checks cover 17 layout scenarios with 510 consecutive sends, plus 6 sends after native zoom. Reading anchors stayed at the same offset in all 17 scenarios; see the side-layout section at the top of `tests/chat-composer-rendering/lazy-message-rendering-windowed-conversation.md`. Delayed observer delivery reproduces the old tail-visibility failure, but the precise field overlap sequence remains unconfirmed.
- History-window and latest-failure unit/wiring cases are updated but were not executed in this change. Playwright network-mock anchor checks passed on desktop, tablet, mobile and independent side windows in both themes on 2026-10-16; see the history-capacity section in `tests/chat-composer-rendering/lazy-message-rendering-windowed-conversation.md`. Real CLI long-sleep recovery remains unverified.
- Static performance review: the history marker is a read-only prop derived from existing state. The component adds no persisted state, polling or subscription and calls the shared latest loader only on explicit thread opening or Jump to latest.

#### Rollback/Cleanup
- Revert the scroll-preservation change in `src/components/content/ThreadConversation.vue` if manual scroll locking needs to be removed.

### 变更：实际触底状态与返回最新箭头同步

前提：准备可控制分页响应的长会话，分别打开主对话、侧窗、独立侧窗、子 Agent 和归档。主对话及侧窗准备可持续输出的测试回复；覆盖明暗主题，375x812、768x1024、1440x1000。

| 操作 | 预期 |
| --- | --- |
| 向上阅读，再通过滚轮、触摸惯性、End 键、拖动滚动条分别回到底部。 | 距最新底部不超过 16px、后方没有未加载内容时，箭头消失，恢复跟随。 |
| 缩放后虚拟行仍在测高，聚焦列表并按 End；另在后方仍有未加载历史时重复。 | 无未加载较新内容时使用现有末行定位并继续有界锁底，测高完成后箭头消失；存在较新历史时仍保持阅读保护，不误认为已到最新。 |
| 一次拖动滚动条到顶部触发分页，保持拖动再回到底部。 | 分页消费其触发意图后仍能恢复跟随；无需额外点击箭头。 |
| 在距离底部 100px 处先触发一次向下滚动事件，再通过惯性到达底部。 | 第一次事件清掉分页意图也不影响第二次触底恢复。 |
| 停在已加载历史窗口的底部，确保服务端仍有较新内容。 | 箭头保留，不将窗口底部当作整个会话的最新位置；点击箭头成功补读后恢复跟随。 |
| 搜索定位旧消息，再手动向下滚到最新底部。 | 解除搜索定位和历史阅读状态，箭头消失，新的流式内容保持可见。 |
| 用程序锚点恢复、虚拟行测高、图片加载或弹出窗口切换改变滚动位置，不做向下输入。 | 不据此解除历史阅读保护；实际已在最新底部时不显示多余箭头。 |
| 加载请求尚未结束时滚到底，待响应结束后继续向下滚。 | 请求期间保留阅读保护；即使已无可滚动距离，后续向下输入也能恢复跟随。 |
| 向下滚动后立即向上，接着触发一次程序滚动。 | 向上阅读取消待恢复跟随意图，不被程序滚动带回最新。 |
| 向下滚动但停在中部，等待滚动结束，再通过布局变化触底。 | 滚动结束会清掉用户恢复意图，后续程序变化不恢复跟随。 |
| 展开命令，在命令输出内部滚动及按键。 | 内层仍有可滚动空间时，不触发外层返回最新。 |
| 无新内容时加载更早消息，再手动滚回最新。 | 已加载历史保持，不触发最新快照请求或额外回收；有真实新内容时沿用现有预算规则。 |

验证边界：新增 `threadConversationScroll.test.ts`，从组件源码提取实际输入和滚动处理函数，以受控几何和状态覆盖上述关键分支；同步更新原有 wiring 断言。End 测高与未读历史保护各补一条回归用例。本轮类型、SFC／TypeScript 语法及差异检查通过，单元用例未执行。

按用户要求执行的原生缩放 Playwright 验收见 `output/playwright/zoom-acceptance.json`：主对话、侧窗、独立侧窗、子 Agent、归档的明暗主题，共 16 组行为检查通过，包含上滚后箭头出现、End 后消失、加载更早后返回底部不裁历史；PC 主对话另验证搜索命中实际进入视口。主对话覆盖 1440x1000、768x1024、375x812，独立侧窗为 760x900。截图前等待 2.3 秒。首轮一次手机 End 停在倒数第二轮，补强末行定位后最终完整矩阵通过；该现象未稳定复现。触摸、真实滚动条、流式期间连续缩放及未读历史边界本轮未另做浏览器专项验收。

性能审查：触底判定仅读取当前滚动容器的几何量，复杂度为 O(1)；滚动过程中维护一个位置标记和一个用户恢复意图，不遍历消息。虚拟列表更新后复用 nextTick 更新位置，恢复跟随沿用已有有界 RAF 锁底；End 补强复用 scrollToBottom，不新增 API、轮询、全会话刷新或无界并发。缩放矩阵新增历史请求为 0，最大长任务 98 ms；没有修复前后帧耗时对照和长期堆内存测量。

清理／回滚：关闭临时测试窗口，恢复主题、语言和视口，只清理专用测试会话；回滚本次提交恢复旧显示与触底逻辑，无存储迁移。
