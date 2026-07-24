### GPT-5.6 Max and Ultra reasoning effort

#### Prerequisites/Setup
1. Sign in with a Codex account whose `model/list` response exposes `gpt-5.6`.
2. For the Ultra case, use an account and model for which `supportedReasoningEfforts` includes `ultra`.

#### Steps
1. Open a new-thread composer and select `gpt-5.6`.
2. Open the Thinking menu.
3. Select `Max`, then send a short prompt.
4. If `Ultra` is listed, select it and send a separate short prompt.
5. Switch to a model whose reported `supportedReasoningEfforts` does not contain `max` or `ultra`.
6. Open the Thinking menu again.

#### Expected Results
- `Max` and `Ultra` appear only when the selected model reports them as supported.
- The started turn sends the selected value as `reasoning_effort`.
- A model without either capability does not show the corresponding option.
- Switching away from a model that supports the selected level changes the active level to the highest reported fallback, preferring `Extra high`.

#### Rollback/Cleanup
- Switch the model and Thinking selection back to the preferred values.
- No server-side configuration migration or generated protocol file is required.
