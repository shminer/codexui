### Model List Search / Filter

#### Feature/Change Name
Search/filter input in the model selection dropdown.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Any provider configured with available models

#### Steps
1. Open any thread or new-thread view
2. Click the model selector button in the composer bar
3. Observe the search input at the top of the dropdown
4. Type a partial model name (e.g., "pickle")
5. Observe filtered results

#### Expected Results
- A text input with placeholder "Search models..." appears at the top of the dropdown
- Typing filters the model list to only matching models (case-insensitive, matches label or value)
- Clearing the search shows all models again
- Pressing Escape clears the search text first, then closes the dropdown on second press
- "No results" shown when no models match the query

#### Rollback/Cleanup
- No permanent changes needed

---

### 全局手动模型：服务端保存与选择器内增删

#### 前提与准备

1. 使用包含本次修改的服务，记录当前提供商及新对话默认模型；准备可恢复的 `CODEX_HOME/.codex-global-state.json` 备份。
2. 配置一个可返回 `GET /v1/models` 的提供商，自动列表中包含 `auto-model`。准备一个该接口未返回的模型 ID，例如 `vendor/manual-model:v2`。
3. 使用两个浏览器连接同一服务，测试过程中避免修改真实工作线程，使用临时线程。

#### 操作与预期

| 操作 | 预期结果 |
| --- | --- |
| 打开首页模型选择器，在搜索框输入 `vendor/manual-model:v2`，点击“添加模型” | 保存成功后关闭菜单并选中该模型；再次打开时存在删除按钮 |
| 刷新页面、重启服务，再用第二个浏览器打开并刷新模型列表 | 手动模型仍存在；同一浏览器的新对话选择恢复 |
| 切换另一个提供商 | 同一手动模型仍显示，自动模型换成目标提供商目录 |
| 搜索 `auto-model` 或已存在的手动 ID | 显示模型已存在；自动模型没有删除入口，列表无重复项 |
| 让接口开始返回 `vendor/manual-model:v2`，刷新目录 | 同名项只显示一次，隐藏删除按钮；接口再次移除它后恢复为可删除的手动项 |
| 在新对话选中手动模型，再删除它 | 弹出确认；成功后从手动目录移除，新对话选中剩余目录首项，空目录则清空选择 |
| 在临时已有线程选中手动模型，再删除它 | 目录记录被删除，当前线程仍显示并使用原模型；历史模型配置保留 |
| 在主对话和侧边对话分别添加一个不同模型 | 三处菜单共享最新手动目录，添加后仅发起操作的对话切换模型 |
| 令自动列表返回空数组 | 模型菜单仍可打开、搜索和添加；手动模型继续可选 |
| 令 `/v1/models` 暂时失败，再刷新 | 当前提供商已成功获取的目录保留；手动模型仍显示；切换提供商后旧提供商自动目录消失 |
| 令手动模型写接口失败，尝试添加或删除 | 显示保存失败；添加输入保留，已有模型及选择保留，操作可重试 |
| 两个浏览器同时添加不同模型，再刷新双方列表 | 两项均保留，操作相互不覆盖 |
| 在深浅主题下，以 375×812 和 768×1024 重复增删 | 菜单、输入、错误及删除按钮清晰可见，长模型 ID 不挤出删除按钮 |

#### 清理与回滚

删除本次添加的手动模型和临时线程，恢复原提供商及默认模型。恢复备份前先停止服务，避免覆盖同时发生的真实偏好修改；手动目录只占全局状态的 `custom-model-ids` 字段。

#### 本轮验证记录

本轮仅执行静态检查；上述运行时、浏览器、多设备及重启验收待执行。
