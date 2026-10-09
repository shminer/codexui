### Thread archive recovery and sidebar pruning

#### Feature/Change Name
Deleting a thread recovers from Codex `no rollout found` archive failures and removes successfully archived threads from the sidebar immediately.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Codex CLI available on `PATH`
3. At least one normal thread and one newly-created thread that has not yet produced a rollout
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, create a new empty thread from the sidebar.
2. Open that thread's menu and choose `Archive thread`.
3. Confirm the thread disappears from the sidebar without a `no rollout found` error.
4. Rename another visible thread, then delete it.
5. Confirm the renamed thread disappears immediately and does not reappear after sidebar refresh/background pagination.
6. Call `thread/list` with `archived:false` through `/codex-api/rpc` and confirm the deleted thread ids are absent.
7. Call `thread/list` with `archived:true` and confirm the deleted thread ids are present.
8. Switch to dark theme and repeat steps 1-5.
9. Select `Archived Conversations` in the sidebar. Load additional pages if needed and locate the archived thread.
   Open its title and page through its read-only preview. Confirm no `thread/resume` or `thread/unarchive` is sent until Restore is clicked; close with Escape and confirm focus returns.
10. Restore it, confirm it disappears from this list without changing the open thread, then select `Current Conversations` and refresh.

#### Expected Results
- Empty or not-yet-materialized threads are archived after CodexUI sets a fallback name and retries.
- Already archived threads are treated as archived instead of surfacing a stale `no rollout found` error.
- The sidebar prunes archived ids from its accumulated paginated list before refreshing.
- Older unarchived threads may appear as the list refills, but archived threads do not remain visible.
- Behavior is consistent in light and dark themes.
- Archived threads have a paginated flat list; restoring persists after refresh and makes the thread visible in its original active project.
- Failed listing/restoration shows an error and allows retry; duplicate restore clicks do not issue duplicate requests.

#### Rollback/Cleanup
- Restore disposable archived threads or archive restored test threads as appropriate.

### 双语会话标签与归档永久删除

#### 前提与准备
- 使用具备原生 `thread/delete` 的 Codex CLI，准备两条仅供验收的归档对话；永久删除不可撤销，不使用重要记录。
- 记录原界面语言及主题。分别检查中文/英文、浅色/深色、桌面及 375×812、768×1024 视口。
- 本轮仅执行静态检查，下列页面验收及运行时回归用例尚未执行。

#### 操作与预期

| 操作 | 预期 |
| --- | --- |
| 将界面设为中文，再切换英文 | 标签分别为“当前会话 / 归档对话”和 `Current Conversations / Archived Conversations`；账户和自动化的 `Active` 含义不变 |
| 在归档列表查看恢复、删除、加载、重试、空状态及预览关闭按钮 | 固定文案、图标提示和无障碍名称跟随界面语言，日期使用对应语言格式 |
| 点击第一条对话的垃圾桶图标 | 显示包含标题的永久删除确认和项目文件保留提示；此时未发出删除请求 |
| 点击取消或在确认区域按 Escape | 收起确认，不删除记录，原记录仍可预览和恢复 |
| 再次打开确认并点击删除，连续重复点击 | 只发出一次 `thread/delete`，参数只包含该 `threadId`；不发出恢复或归档请求；期间同一行的恢复、删除及预览入口禁用 |
| 观察删除成功后列表，重新搜索该标题并刷新页面 | 列表及归档搜索不再显示记录，关联预览关闭；当前打开的其他会话保持不变 |
| 保留一次分页或搜索请求，删除记录后再让旧请求返回 | 旧结果不把已删除记录加回列表，其他记录及分页仍可用 |
| 模拟删除请求失败，随后解除失败条件并重试 | 保留记录及确认入口，显示错误并恢复按钮；重试成功后移除 |
| 在恢复请求进行时尝试删除，及在删除进行时尝试恢复 | 同一记录操作互斥，不产生第二种操作的请求 |
| 删除曾经预览或打开过的归档记录，再读取其历史 | 不返回删除前的快照、分页、实时状态或命令输出；删除期间的迟到读取失效 |
| 延迟删除响应，切到当前会话，再返回归档对话；让新列表在删除完成前显示原记录，最后放行删除响应 | 操作中状态跨标签保留，同一记录的恢复、删除及预览入口禁用；完成后新列表移除该记录，旧列表不更新，不产生重复请求 |
| 在恢复请求未完成时切换标签并返回，再放行响应；另以删除失败响应重复上述切换 | 恢复同样保持互斥并更新新列表；删除失败显示错误，操作锁解除，可重新确认重试 |
| 向验收会话排队两条消息，中断当前回合使队列暂停；归档后永久删除，刷新页面 | 对应待发送文本和附件引用从应用持久化队列移除，其他会话的队列保留；后台取消该会话的排队定时器 |
| 分别延迟后台队列的历史读取、恢复请求和回合启动请求，期间删除会话，随后放行读取/恢复或让启动失败 | 删除后的在途任务不再发起新的回合，不把失败消息重新写回队列；迟到的客户端队列读取/编辑响应也不恢复已删队列 |
| 模拟原生删除失败，检查原队列，再解除失败条件并重试 | 删除失败保留待发送内容与调度；成功后才清理，不影响其他会话；切换语言和主题不改变结果 |
| 检查对应项目目录 | 项目源文件保持不变，本功能只删除对话记录 |
| 重复检查明暗主题及窄视口 | 标签可换行，确认提示、操作按钮和错误信息不溢出，深色主题无突兀浅色背景 |

#### 清理
恢复原语言、主题及视口。永久删除的验收记录无恢复步骤；保留用于其他测试的记录可通过恢复按钮返回当前会话。
