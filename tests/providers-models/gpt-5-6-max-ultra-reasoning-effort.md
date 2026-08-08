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
6. Open the Thinking menu again, refresh the page, and send a separate prompt.
7. With two Codex accounts, set account A to `gpt-5.6` plus `Ultra`, set account B to a different model and Thinking value, then switch between the accounts and refresh each one.

#### Expected Results
- `Max` and `Ultra` remain visible when they are the last selected Thinking value, even if the refreshed catalog does not report them for the current model.
- The started turn sends the selected value as `reasoning_effort`.
- Switching models and refreshing do not lower the active Thinking value automatically.
- Reopening the same main thread restores its last model and Thinking value.
- When an existing thread has no saved Thinking value, the displayed value and its next `turn/start` request both use the current runtime value.
- New chats restore the last model and Thinking value for the active account, even when both accounts use the Codex provider.

#### Rollback/Cleanup
- Switch the model and Thinking selection back to the preferred values.
- No server-side configuration migration or generated protocol file is required.
