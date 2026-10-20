### 变更：侧窗后台返回后正文重叠，恢复普通布局

当前行为：嵌入侧窗、手机侧窗和独立标签页使用普通文档流；主对话及其他默认调用者继续使用虚拟列表。侧窗不再依赖虚拟行高度、绝对定位、逐行测量和窗口切换重挂载。下方旧测高／虚拟行记录保留供主对话回归参考，不再作为侧窗实现及验收依据。历史分页、已完成正文合并、旧快照保护和容量限制保持原逻辑。

前提：安装仓库依赖，在当前仓库运行 `pnpm run dev --host 127.0.0.1 --port 4173`。Windows 当前 wrapper 的 `spawnSync vite.cmd` 若报 `EINVAL`，使用等价 Vite 入口 `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173`；不要重启 5173。确认 4173 属于当前仓库。运行 `node scripts/test-side-conversation-flow.cjs`；脚本通过隔离浏览器中的 `/__side-flow-test` 测试页挂载实际 `ThreadSideConversation` / `ThreadConversation` 组件及共享样式，消息、分页回调和 prompts API 使用固定数据，不是实际 Codex 会话端到端测试。

| 操作 | 预期 |
| --- | --- |
| 打开至少 30 轮混合正文、命令组、代码、表格、Context compacted、Worked 和唯一末尾标记的侧窗，再弹出独立标签页。 | 每个消息及内部正文块互不重叠；正文在消息边界内；无虚拟行定位容器，无横向溢出，输入框不被覆盖。 |
| 暂停父窗口及独立标签页 RAF、延迟 ResizeObserver 500ms；追加流式内容并替换为完整正文。然后仅恢复独立标签页，模拟切出浏览器后返回、父标签页仍在后台。 | 即使调度暂停，正文也自然撑开；恢复后独立标签页跟随完整末尾，不依赖父窗口 RAF。 |
| 真人在 Android 浏览器打开独立侧窗，开始长回答后切到其他应用，等待新内容产生再返回；重复后台／前台切换。 | 新正文把后续消息向下推开，无覆盖、截断或只能刷新才能恢复的问题。记录设备、浏览器版本和后台停留时间；自动化故障注入不能替代此项。 |
| 向上阅读时追加回答、加载更早历史；模拟历史请求失败，再加载更晚历史并返回最新。 | 阅读位置与消息锚点保持；错误有提示且原正文保留；恢复及返回最新有效。 |
| 展开命令组、加载延迟图片、定位已加载旧消息并返回最新。 | 内容自然扩展；阅读时不抢位置，跟随最新时图片加载后末尾仍可见。 |
| 收回窗口、切换会话、最小化后重开、卸载组件。 | 无旧会话正文残留；观察器迁移到实际文档；卸载后无观察器和未完成动画回调。 |
| 检查 375×812、768×1024、1440×1000 的明暗主题。 | 截图无遮挡、无重叠；深色侧窗及输入框没有浅色底板。 |
| 在共享组件普通模式加载 1000 条、接近历史文本预算的内容，再切换回默认主对话模式并搜索。 | 普通模式保留全部已加载正文；默认主对话仍只挂载视口附近消息，搜索定位可用。记录耗时，不以正文缺失换取速度。 |

Windows Chromium 自动化结果：34 个布局检查及交互／生命周期断言通过，0 页面异常；三种尺寸各保存明暗截图 `output/playwright/side-flow-{375,768,1440}-{light,dark}.png`，结果及性能数据为 `output/playwright/side-flow-results.json`。测试 URL 为 `http://127.0.0.1:4173/__side-flow-test`，实际弹出页为 `http://127.0.0.1:4173/side-conversation.html`。三种尺寸后台返回后的底部距离均为 0；每个侧窗仅一个尺寸观察器，弹出／收回不增加历史请求，卸载后观察器与 RAF 均为 0。

性能审查：侧窗直接渲染当前已加载数据，不增加网络请求、订阅、后台轮询或自动全历史加载。30 轮混合内容场景的父页初始渲染约百毫秒级，独立标签页后台返回阶段未记录超过 50ms 的长任务。容量压力场景为 1000 条、11,640,780 UTF-8 字节、17,504 个 DOM 节点；本机从更新到布局检查约 4.1 秒，其中最长任务约 3.4 秒。此为大量历史展开的已知代价；常规消息窗口、现有容量上限及命令折叠不变，未测 Android 真机耗时和长期堆内存。普通布局与历史上限之间的取舍按本轮确认方案执行。

工程验证：相关单元测试 39 项通过；`vue-tsc --noEmit`、`pnpm run build`、`codexui --help`、`codexui-safe doctor` 和 `git diff --check` 通过。全量单测为 893 通过／19 失败／6 跳过，另有 safe CLI 套件在 Windows 调用 `pnpm` 时 ENOENT；失败名称与修改前基线一致（基线 888 通过／19 失败／6 跳过）。既有失败包含侧窗历史竞争、Windows 权限／路径及打包测试环境问题，不宣称全量通过。

构建入口核对：本机 `codex-mobile` 的 `codexapp` Junction 指向当前仓库；用该链接的 `dist-cli/index.js` 配合 `--no-login --no-tunnel --no-open --no-password --port 4192` 临时启动，HTTP 返回的 JS 与当前 `dist` 字节一致，且包含 `conversation-flow-list`。结果在 `output/playwright/side-flow-built-smoke.json`。这验证了构建与入口对应关系，不代表手机当前打开的服务已经重启／刷新。

清理／回滚：脚本关闭隔离浏览器上下文，固定数据不写入真实会话；4173 保持运行，临时 4192 验证进程已停止。截图、日志和性能结果位于忽略目录 `output/playwright/`。如需回滚，仅撤销本次侧窗普通布局提交并重新构建；不要整批回退混合历史分页／正文数据修复的旧提交。

### 变更：侧窗回答尾部截断与发送后消息重叠

前提：从当前仓库启动页面，使用可控制最后一段增量、完成通知及后续快照的 Mock 会话。回答包含多段正文、12 行表格、25 行以上代码块和唯一末尾标记；每三轮加入命令组。覆盖主对话、侧窗及独立窗口，明暗主题。

| 操作 | 预期 |
| --- | --- |
| 流式输出长回复，紧接最后一段发送完成通知，暂不发送下一条消息。 | 状态文本及 DOM 包含完整末尾；最新位置自动显示最后一行，后续块不只露出上边缘。 |
| 回答完成后立即通过输入框发送下一条，连续重复至少 30 轮。 | 相邻消息无重叠、无重复；实际正文边界处于虚拟列表分配范围内。 |
| 将虚拟行 ResizeObserver 通知延迟 350 ms，重复发送。 | 正文更新后主动重新测高；迟到的尺寸报告得到实际测量校正；测高结束后末尾继续进入视口。 |
| 阅读表格上方历史时接收新一轮回答，再返回最新。 | 阅读位置保持；主动返回最新后新回答完整可见。 |
| 拖动侧窗右下角缩小宽高、弹出独立窗口，分别检查窄窗口与 1500x720 宽窗口。 | 换行及容器变化后测高和末行定位正常，输入框与正文无重叠。 |
| 原生浏览器连续切换 125%、150%、100%，每次缩放后发送。 | 字号配置保持，末尾完整；虚拟行仍使用 top/left，transform 为 none。 |
| 所有内容稳定后等待 400 ms。 | 无新增行高测量，避免测高与滚动形成空闲循环。 |

实现：共享列表使用内部 `ConversationVirtualRow`，复用组件库公开的 `useDynamicScrollerItem` 和有界测量队列。DOM 更新后重新测量，尺寸报告后再次校正实际几何；有效行高变化驱动现有合并滚动调度。阅读历史时仅更新底部判定，保持原有阅读保护。未改正文状态合并、服务端接口、分页和容量预算，未回退 disable-transform。

已证实的问题路径：旧组件下延迟尺寸通知可稳定触发“状态及 DOM 已完整、follow 仍为 true、滚动位置留在旧高度、末尾持续不可见”。原生组件的尺寸更新没有接入外层底部跟随，固定帧补偿结束后遗漏较晚的高度变化。库内延迟回调还存在投递时节点身份已变化的情况，包含复用或卸载；新消息行通过当前 DOM 测量校正。用户现场持续重叠的精确时序未直接捕获，不将故障注入等同于现场根因已全部确认。

截图验收（2026-10-16）：`http://127.0.0.1:4173/#/thread/review-testchat`，独立窗口为 `http://127.0.0.1:4173/side-conversation.html`。使用 Linux Chrome、Playwright HTTP/RPC/WebSocket Mock，每张最终截图等待 2.3 秒。

| 检查 | 实际结果 |
| --- | --- |
| 主对话与侧窗，1440x1000、768x1024、375x812，明暗主题 | 12 个场景，每个连续发送 30 轮；末尾、状态全文、相邻消息边界及实际裁切范围检查通过。 |
| 独立窗口 760x900，明暗主题 | 2 个场景，每个连续发送 30 轮通过。 |
| 延迟尺寸通知：PC 侧窗、手机侧窗、1500x720 独立窗口 | 3 个场景，每个连续发送 30 轮通过；共记录 453 批延迟通知、841 次投递时目标 ID 已变化，实际末尾及边界保持正常。 |
| 阅读保护、返回最新及 PC 侧窗拖动缩放 | 17 个场景阅读锚点偏移均为 0；返回最新及窗口尺寸变化后的末尾检查通过。 |
| 原生缩放文字对比及连续缩放后发送 | 13 项检查通过，含 5 对刷新前后文字样本 RMSE 为 0，以及 PC／手机各 3 次缩放后发送。样本结果不代表整页像素一致。 |
| 汇总 | 17 个布局场景、510 轮发送，另 6 次原生缩放后发送；0 失败、0 页面／非预期控制台异常。84 张页面截图、另 10 张文字裁剪；页面截图经 10 张联系表全部查看，并放大核对宽独立窗口、手机侧窗及 PC 返回最新。 |

最终汇总为 `output/playwright/side-layout-summary.json`，脚本为 `side-layout-regression.cjs`、`side-layout-summary.cjs`，原生缩放脚本为 `zoom-acceptance.cjs`。报告清单见汇总的 reports 字段。PC 浅色侧窗以 `side-layout-side-pc-final.json` 为准，替代同场景较早截图，避免旧组件对照运行覆盖最终证据。

复现示例：`rtk proxy env CASE=side-1440-light RO_DELAY=350 TAG=delayed-after REPORT=side-layout-delayed-after.json node output/playwright/side-layout-regression.cjs`。字体及缩放发送检查：`rtk proxy env CASE=side-1440-dark ZOOMS=1.25,1.5,1 CHECK_SEND=1 TAG=side-layout REPORT=side-layout-zoom-pc.json node output/playwright/zoom-acceptance.cjs`。旧组件故障注入报告为 `side-layout-delayed-baseline.json`，其预期失败不计入最终通过数。中间选择器曾误选隐藏副本、误将主输入框视为消息列表子节点；修正后重跑通过，未据此修改生产逻辑。

性能审查：仅对已挂载行调用现有测量队列，每次刷新最多处理 6 个队列任务；无新 observer、轮询、全历史扫描或网络请求。30 轮中最多记录 3850 次行 offsetHeight 读取，所有场景稳定后 400 ms 的新增测量均为 0。主对话场景无 turn-page 请求，侧窗每场景 32 次，来自恢复、完成同步和明确返回最新，测高回调不发请求。本轮布局及缩放采样未记录长任务；没有修改前后的帧耗时对照、长期堆内存或真实后台休眠测量。窄屏放大后的既有输入框边缘裁切参见下方缩放章节，未据此扩展修改范围。

静态检查：`vue-tsc --noEmit`、两个 Vue SFC 语法编译、三个回归测试文件 TypeScript 语法检查和 `git diff --check` 通过。已更新单元回归用例，未运行 Vitest、构建或发布。Windows／跨显示器及真实 CLI 长时间会话未验收；本轮未单独复测子 Agent／归档的浏览器流程。

清理／回滚：关闭隔离浏览器上下文释放 Mock、主题和缩放数据，4173 保持运行；无真实消息修改或存储迁移。回滚本次提交恢复旧行测高接线。

### 变更：缩放后虚拟行文字清晰度

前提：从当前代码启动页面，准备包含多轮正文、列表、表格、代码及流式回复的会话；检查主对话、侧窗、独立侧窗、子 Agent 和归档的明暗主题。浏览器默认字号保持原设置。

| 操作 | 预期 |
| --- | --- |
| 以 100% 缩放打开，依次切换到 80%、90%、110%、125%、150%，再回到 100%，全过程不刷新。 | 每次缩放完成后的文字清晰度与同倍率刷新后的显示一致，无持续发虚。 |
| 在浏览器开发者工具中检查挂载的虚拟行。 | 使用 top/left 定位，计算样式 transform 为 none，will-change 不再为 transform；列表仍只挂载视口及缓冲区内的行。 |
| 缩放后上下滚动、加载更早消息、返回最新、搜索旧消息。 | 消息顺序、分页及搜索定位保持正确，无缺失或重叠；阅读时不异常跳到最新。 |
| 在最新位置缩放并持续接收流式回复，再向上阅读。 | 最新位置继续跟随；向上阅读后保留阅读保护。 |
| 侧窗弹出为独立窗口，缩放后移回；将窗口移到不同系统缩放比例的显示器。 | 测量与定位正常，不依赖刷新恢复清晰度；记录浏览器、系统和显示器缩放比例。 |

实现及性能审查：共享 DynamicScroller 开启内置 disable-transform，依赖的 position 分支使用 top/left 并移除 transform、will-change: transform；保留原有动态测高、400px 缓冲区、分页和有界正文缓存。无新增缩放监听、重挂载、请求或计时器。此次缩放操作新增历史请求为 0，虚拟池最多挂载 31 个带消息 ID 的节点，少于已加载消息；测试记录的最大长任务为 98 ms。top/left 定位可能增加布局开销，本轮没有修复前后的帧耗时对照或长期堆内存测量。

截图验收（2026-10-15）：用户明确要求截图后，使用当前仓库的 `http://127.0.0.1:4173/#/thread/review-testchat`，在 Linux 无头 Chrome for Testing 151.0.7922.34 中运行 Playwright 与受控网络 Mock。通过隔离扩展调用 chrome.tabs.setZoom 实现原生浏览器缩放；125% 时 1440px 视口的 innerWidth 为 1152、DPR 为 1.25，未使用 CSS zoom 或页面捏合代替。

| 覆盖 | 实际结果 |
| --- | --- |
| 主对话，1440x1000，明暗主题，80%、90%、110%、125%、150%、100% | 连续缩放不刷新，与相同倍率刷新后逐对截图比较。 |
| 主对话，768x1024、375x812，明暗主题，125%、100% | 正文、代码、表格及窄屏换行均截图；字号分别保持 14px、13px。 |
| 侧窗、子 Agent、归档，1440x1000；独立侧窗实际 760x900，明暗主题，125%、150% | 共用列表虚拟行 transform 为 none，不使用 will-change: transform。 |
| 手机侧窗，375x812，明暗主题，125%、100% | 刷新前后文字样本一致，返回底部与较早分页检查通过。 |
| 上滚、End 返回最新、加载更早至 30 轮、无新内容返回底部、PC 主对话搜索 | 箭头显隐、完整历史保留及搜索命中进入视口的断言通过。 |

最终报告为 `output/playwright/zoom-acceptance.json`，摘要为 `zoom-acceptance-summary.json`，入口为同目录 `zoom-acceptance.cjs`。共 56 组检查通过，0 组失败、0 条页面／非预期控制台异常；80 张页面截图和 80 张文字裁剪，经 9 张 `zoom-contact-*.png` 联系表逐张查看。40 对单行中英数字文字样本裁剪，在仅去除背景边缘、不缩放或滤镜处理后，刷新前后 RMSE 均为 0；此结果只代表这些文字样本，并非整页像素完全一致。

取证修正：首轮曾选到隐藏虚拟节点，原生缩放下 Playwright 裁剪坐标也曾偏移。最终使用可见节点和 CDP 原始 viewport framebuffer，并依据实际 PNG 尺寸裁剪；首轮诊断报告不计入上述通过数。首轮另出现一次 End 后停在倒数第二轮，未稳定复现；已补强 End 使用现有末行定位，最终完整矩阵通过，不能据此认定用户现场根因。

布局边界另记：375px 视口放大至 125% 后，innerWidth 为 300px，主对话发送按钮右缘约为 306.68px，发生边缘裁切；100% 时正常。通过浏览器模块请求拦截，仅将 disable-transform 临时恢复为 false 对照，按钮位置完全相同，说明此裁切不由本轮虚拟行定位修改引入；证据为 `zoom-input-bounds.json`、`zoom-input-baseline.json` 及 `zoom-input-baseline-transform.png`，仓库源码未因此变更。该问题不影响上述文字样本对比和分页断言，未将本轮结果表述为所有布局均无问题。Windows GPU、跨物理显示器、真实流式输出期间连续缩放和长期后台恢复未验收；未执行构建、发布或单元测试。

清理／回滚：恢复浏览器 100% 缩放、原主题和窗口位置，关闭专用测试窗口；移除 disable-transform 选项及其回归断言即可回滚，无存储变更。

### 变更：历史容量静默限制与自动释放

前提：准备超过 150 轮、每轮包含多条消息的可控会话，以及可控制通知、重复快照和最新读取失败的网络 Mock。覆盖主对话、侧窗、独立侧窗、子 Agent 与归档；明暗主题，1440x1000、768x1024、375x812，独立窗口 760x900。

| 操作 | 预期 |
| --- | --- |
| 持续加载更早内容直到相邻完整轮次超出 16 MiB／1000 条预算。 | 保留已加载内容；禁用继续加载，没有容量提示或清理按钮，返回最新箭头仍可用。 |
| 容量满后滚动触顶、点击禁用按钮，重复同步相同快照。 | 不再请求分页；相同快照不会重新启用加载按钮。 |
| 无新内容时回到底部、点击返回最新，重复读取相同快照。 | 已加载消息集合及顺序保持，不触发回收。 |
| 阅读历史时产生新正文、命令输出并完成轮次。 | 保留阅读内容和锚点；不因新内容立即删除正在阅读的正文。 |
| 有新内容后返回最新，先模拟读取失败再重试成功。 | 失败保留原窗口与容量状态；成功后按原有正常预算自动释放旧缓存，恢复分页。 |
| 回到最新，加载历史再返回，立即完成一轮快速回复。 | 沿用通知批处理完成一次正文同步，近期缓存复用不再阻止自动回收；完整最新回复可见。 |
| 无吞吐指标，再产生带 token usage 的回复。 | 无指标时不渲染状态行；有指标时仅显示原有性能指标，详细说明仍可展开，明暗主题无残留历史控件或空白行。 |
| 子 Agent／归档加载历史，然后成功读取带新内容的最新快照。 | 自动释放旧缓存；无新增编辑或发送能力，游标、完整轮次和虚拟化仍有效。 |

实现及性能审查：删除历史提示的 Teleport、输入框插槽、回调及强制清理参数；内部容量状态继续拦截分页。容量标记保持到实际回收或窗口重置，避免重复快照使其失效。主对话仅在通知标记为脏、轮次已结束、历史确有变化且不在历史窗口时绕过最近读取缓存，复用既有批处理；不增加轮询或全历史读取。

截图验收（2026-10-16）：使用当前仓库的 `http://127.0.0.1:4173/#/thread/review-testchat`，执行 Playwright HTTP/RPC/WebSocket Mock。主对话和侧窗覆盖 1440x1000、768x1024、375x812 明暗主题；独立窗口为 760x900 明暗主题；子 Agent、归档为 PC 明暗主题。每张截图等待 2.3 秒后采集。

| 检查 | 实际结果 |
| --- | --- |
| 完整矩阵 `output/playwright/history-auto-release.cjs` | 18 个场景通过，0 失败、0 页面／非预期控制台异常，50 张截图。 |
| 消息容量与重复快照 | 150 轮、每轮 7 条；连续加载后保留 994 条／142 个完整轮次。满时滚动触顶及点击禁用按钮，新增分页请求均为 0；两次相同快照后消息 ID、顺序和禁用状态保持。 |
| 阅读保护与自动释放 | 阅读时收到新内容及完成通知仍保留窗口与锚点；最新读取失败保留原内容，重试成功后收敛到 20 轮并恢复分页。最新位置快速完成新轮后也自动收敛，最终回复可见，返回最新箭头消失。 |
| 失败重试 | 可写页面共模拟 14 次预期 HTTP 503；单独记录，全部完成后续重试检查。 |
| 字节容量 `output/playwright/history-auto-release-bytes.cjs` | 1 个场景通过，0 失败、0 异常，1 张截图。每轮正文 920,023 字符，10 轮页仅接纳相邻完整 9 轮，最新端保留；相同快照仍禁分页，新内容快照后恢复正常预算。 |
| 画面与性能 | 51 张原图经 6 张联系表全部查看，另放大 PC 深色、手机侧窗及独立窗口。容量场景最多挂载 42 个消息节点，普通矩阵记录中未出现长任务；大正文压力最大长任务 802 ms。 |

报告为 `output/playwright/history-auto-release.json`、`history-auto-release-bytes.json`，汇总为 `history-auto-release-summary.json`；截图为 `history-auto-release-*.png`。复现命令为 `rtk proxy node output/playwright/history-auto-release.cjs` 和 `rtk proxy node output/playwright/history-auto-release-bytes.cjs`，汇总及联系表由同目录 `history-auto-release-gallery.cjs` 生成。

取证说明：中间两次独立窗口检查被保存测试文档引发的 Vite 整页刷新打断，服务日志时间与窗口关闭对应；暂停文件修改后重新执行完整矩阵，得到上述最终结果。中间报告不计入通过数。普通矩阵未记录长任务只代表此次采样；压力场景存在 802 ms 长任务，本轮没有修复前后性能对照或长期堆内存测量。

静态检查：`vue-tsc --noEmit`、6 个 Vue SFC 语法编译、7 个改动 TypeScript 文件的语法检查及 `git diff --check` 通过。已更新单元回归用例但未运行 Vitest；未执行构建、发布，未验收真实 CLI 长时间休眠恢复及 Windows 环境。

清理／回滚：关闭隔离 Mock 窗口，恢复主题、语言和视口；无需清理真实会话或迁移 localStorage。回滚本次提交恢复旧提示及手动清理入口。

### 功能：稳定历史缓存与动态高度虚拟列表

本轮已按用户要求执行 Playwright 截图验收，采用 HTTP/RPC/WebSocket Mock 及真实会话只读检查。结果见下表；下方旧完成态和保留预算章节中的历史通过数仍属于此前提交。

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
| 加载历史至估算 16 MiB 或 1000 条。 | 保留已加载集合，静默暂停继续接纳；相邻一轮放不下时停在它之前，不跳过，不把另一端挤掉。 |
| 有新内容后返回最新，先失败再重试成功。 | 失败不变更窗口；成功后自动释放历史并恢复最新预算和跟随。 |
| 搜索旧消息；切到独立侧窗再移回。 | 按稳定消息 ID 转换为虚拟索引定位；文档切换重建测量环境，以消息 ID 和偏移恢复阅读位置。 |
| 连续流式输出 12 段正文，立即完成并附加独有末尾标记；在主对话、侧窗及独立侧窗中重复。 | 末尾段落及标记进入可视区域；数据已完成后，页面不保留较短的旧正文，不依赖点击历史加载按钮。 |
| 搜索未加载的旧轮次，再关闭搜索，重复定位另一条命中。 | 命中消息实际滚入视口；主动定位重建测量锚点，不被旧阅读锚点拉回。关闭搜索后最新正文正常显示。 |
| 回滚使消息变少；切会话；最小化侧窗后恢复。 | 非空会话正常显示；切换重置测量缓存；既有非活跃／最小化预算、草稿与队列保护仍有效。 |

清理：关闭测试侧窗和独立窗口，恢复主题、语言及视口；只删除专门建立的测试会话。本次无存储格式迁移，源码回滚恢复原分页实现。

本轮截图验收记录（2026-10-15）：

最终六套报告共 47 组浏览器检查通过，0 组失败、0 条页面／非预期控制台异常，共 67 张截图；汇总为 `output/playwright/stable-history-summary.json`。全部截图已按 12 张联系表检查，另放大核对了搜索、手机侧窗完成正文、PC 子 Agent 及容量提示。普通 Mock 最大长任务为 82 ms；大正文压力另计，见下方性能边界。

| 检查与报告（均在 `output/playwright/`） | 结果 |
| --- | --- |
| `stable-history-acceptance.json`；同名 `.cjs` 为运行入口 | 1440x1000、768x1024、375x812 的明暗主题，主对话／侧窗／子 Agent；另验收 760x900 独立侧窗。检查分页、锚点、缓存保留、无额外请求和外部点击关闭菜单。 |
| `stable-history-lifecycle.json`；同名 `.cjs` | PC／手机明暗主题：释放失败保留窗口、无新内容普通返回保留历史、阅读期间新内容与完成后返回、正常预算收敛、搜索命中实际进入视口。 |
| `stable-history-side-completion.json`；同名 `.cjs` | PC／手机／独立侧窗明暗主题：连续流式正文的最终标记可见；60 条命令结束后延迟到达的正文自动显示，无额外加载操作。 |
| `stable-history-capacity.json`；同名 `.cjs` | PC／手机消息容量压力保留 994 条、每轮 7 条，下一整轮超限时停止；字节压力页每轮正文 920,023 字符，仅接纳相邻 9 个完整轮次。两者均保留最新端，显式释放恢复最新预算。 |
| `stable-history-archive.json`；同名 `.cjs` | PC／手机明暗主题：归档只读预览的相同分页、锚点、缓存和返回最新行为。 |
| `stable-history-real.json`；同名 `.cjs` | 会话 `01a1385b-f9e5-7211-9321-3525156f9aef`，1440x1000 浅色、375x812 深色，只读取：最终复跑为 139 条扩展至 300 条，锚点偏移均为 0，无滚动请求或普通返回后的回收。会话在验收期间被外部继续使用，因此不同轮次记录的消息数有变化。 |

验收过程中曾出现一次 375px 浅色主对话分页计数从预期 40 轮变为 20 轮；当次未留存足以定位原因的请求记录。增加失败请求记录后独立连续复跑三轮通过，报告为 `stable-history-mobile-repeat.json`（12 组检查）；最终完整矩阵再复测通过。该次原因未确认，不将“未重现”描述为已修复。原 4173 服务随后退出导致连接失败，已从当前仓库重启，并重新采集最终六份报告。

复现命令：在确认 4173 属于当前仓库且依赖就绪后，分别运行 `rtk proxy node output/playwright/stable-history-<上表名称>.cjs`。截图使用 `stable-history-*.png`，每张等待 2.3 秒后采集。测试上下文关闭即释放 Mock、主题和临时浏览器数据，4173 保持运行；真实会话未发送、编辑、回滚或删除。

本轮发现并修复两处展示问题：搜索旧消息被旧测量锚点抵消；虚拟行复用时正文 `v-memo` 偶发保留完成前的短正文。主动搜索定位仅重建当前虚拟列表测量，普通分页仍保留 shift 锚点；移除正文 VNode memo 后继续使用已有有界 Markdown／高亮缓存及流式节流。

性能边界：缓存 80 条正文的普通 Mock 场景，虚拟池实际挂载约 18–27 个带消息 ID 的节点；994 条压力缓存挂载 37–42 个，未挂载全部正文。分页请求数、锚点偏移和 long task 记录在报告中。920,023 字符／轮的大正文压力场景最终记录到 798 ms 长任务，说明大响应解析和单轮渲染仍有明显开销；没有将其视为长期流畅或堆稳定性证明。中英文完整矩阵、真实图片加载、长时间后台休眠及堆回收曲线仍待专项验证；本轮未执行构建、发布或全量单元测试。

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
- Loaded older history is kept until new content is followed or the thread becomes inactive. Historical admission silently pauses at 16 MiB estimated text or 1000 messages without evicting the opposite end; duplicate snapshots keep the pause until actual release or a window reset.
- Streaming code is shown without repeated syntax highlighting; completed large code blocks avoid synchronous highlighting and oversized cache entries.
- Protected temporary/unpersisted content, a single oversized turn, explicit full-copy allocations, and upstream full-item reads are documented exceptions to strict memory bounds.

#### Rollback/Cleanup
- Close output details and history panels; temporary page caches are released. No saved conversation is deleted or migrated.
- Remove only test conversations/commands intentionally created for this check. Keep existing persistent service processes running.
