### Provider models accept Codex catalog payloads

#### Feature/Change Name
Provider-backed model discovery accepts both OpenAI-compatible and Codex catalog `/models` payloads.

#### Prerequisites/Setup
1. Build the project with `pnpm run build`.
2. Start the app and open it in the browser.
3. In Settings, choose `Custom endpoint`, set API format to `Responses`, and point the endpoint URL at a test provider base URL such as `http://127.0.0.1:8666/v1`.
4. Have that provider return `{"models":[{"slug":"gpt-5.4"}]}` from `GET /v1/models`.

#### Steps
1. Open the model selector for the provider-backed thread or new-chat composer.
2. Confirm the selector includes model ids from the provider `models[].slug` payload.
3. Select one of the discovered models and start a new thread.

#### Expected Results
- `/codex-api/provider-models` returns model ids from either `data[].id` or `models[].slug`.
- The model selector is not reduced to only the configured fallback model when the provider returns a Codex catalog payload.
- Starting a thread passes the selected model id through to Codex.

#### Rollback/Cleanup
- Switch the provider back to the preferred default.

---

### Codex 提供商配置驱动的模型发现

#### 前提与准备

准备两个测试提供商 `provider_a`、`provider_b`，在各自的 `base_url` 下提供 `/models`，分别返回不同模型 ID。配置 `base_url` 为带或不带末尾斜杠的 `/v1` 地址，并准备服务进程能读取的测试环境变量。

#### 操作与预期

| 操作 | 预期结果 |
| --- | --- |
| 在 Codex 配置中选择 `provider_a`，设置 `env_key`，刷新模型目录 | 请求 `provider_a` 的 `/v1/models`，附带对应 Bearer Token |
| 添加 `http_headers`、`env_http_headers` 和 `query_params` | 显式头优先；环境变量补充缺失的头；原有与配置查询参数保留 |
| 同时设置显式 Authorization、环境 Authorization、显式 Bearer Token 与 `env_key` | 优先使用显式 Authorization，其次环境 Authorization、显式 Bearer Token、`env_key` |
| 分别使用 `responses` 与 `chat` 对话协议配置 | 模型发现均请求 `/models`，解析结果相同；此项只验证模型目录，不代表上游对话协议兼容性 |
| 当前活动提供商为 `provider_b` 时打开归属 `provider_a` 的线程 | 模型发现使用 `provider_a` 配置；请求参数中的 `provider-a` 能对应配置键 `provider_a` |
| 指定不存在的提供商 | 返回失败，保留相应已有状态，避免改用活动提供商的模型目录 |
| 模拟超时、HTTP 401、错误 JSON 与缺少模型数组的响应 | 返回失败，客户端保留当前提供商最近成功目录；日志及响应不输出密钥或完整鉴权配置 |
| 切回默认 Codex 提供商 | 沿用原有 `model/list` 目录，保留已有推理强度能力信息 |

#### 清理与回滚

恢复测试前的 Codex 提供商配置及环境变量，删除测试线程并停用测试提供商端点。本轮仅执行静态检查，以上运行时验收待执行。
