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
- History/newer flags stop bottom locking immediately. Clearing those flags in a same-thread background update does not independently turn following back on.
- Scrolling inside the loaded virtual list does not request history or evict body content. Ordinary return to latest preserves expanded history when no new content exists; an unread server boundary requests latest, and explicit Release history performs a successful read before eviction.

#### Verification Boundary
- New history-window and latest-failure checks have unit/wiring coverage; live browser anchor verification remains pending.
- Static performance review: the history marker is a read-only prop derived from existing state. The component adds no persisted state, polling or subscription and calls the shared latest loader only on explicit thread opening or Jump to latest.

#### Rollback/Cleanup
- Revert the scroll-preservation change in `src/components/content/ThreadConversation.vue` if manual scroll locking needs to be removed.

### 变更：实际触底状态与返回最新箭头同步

前提：准备可控制分页响应的长会话，分别打开主对话、侧窗、独立侧窗、子 Agent 和归档。主对话及侧窗准备可持续输出的测试回复；覆盖明暗主题，375x812、768x1024、1440x1000。

| 操作 | 预期 |
| --- | --- |
| 向上阅读，再通过滚轮、触摸惯性、End 键、拖动滚动条分别回到底部。 | 距最新底部不超过 16px、后方没有未加载内容时，箭头消失，恢复跟随。 |
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

验证边界：新增 `threadConversationScroll.test.ts`，从组件源码提取实际输入和滚动处理函数，以受控几何和状态覆盖上述关键分支；同步更新原有 wiring 断言。依据本轮执行限制，仅做类型、SFC 语法及差异检查，新增用例和浏览器截图尚未运行，既有截图报告不作为本次变更的证明。

性能静态审查：触底判定仅读取当前滚动容器的几何量，复杂度为 O(1)；滚动过程中维护一个位置标记和一个用户恢复意图，不遍历消息。虚拟列表更新后复用 nextTick 更新位置，恢复跟随沿用已有有界 RAF 锁底；没有新增 API、轮询、全会话刷新或无界并发。实际帧耗时、请求计数及长期堆内存本轮未测量。

清理／回滚：关闭临时测试窗口，恢复主题、语言和视口，只清理专用测试会话；回滚本次提交恢复旧显示与触底逻辑，无存储迁移。
