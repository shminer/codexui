### Provider-scoped model defaults + OpenRouter completions bash fallback

#### Feature/Change Name
Model defaults are stored per provider (no cross-provider leakage), and OpenRouter `Completions` mode preserves shell-tool execution by routing tool-capable requests through Responses compatibility.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open Settings panel
3. OpenRouter key configured

#### Steps
1. Switch provider to `OpenRouter` and choose a specific OpenRouter model and Thinking value in composer selector
2. Switch provider to `Codex`
3. Choose a Codex model and Thinking value different from the OpenRouter ones
4. Switch back to `OpenRouter`
5. Reload the page and verify the previous OpenRouter model and Thinking selections are restored
6. In OpenRouter settings, set API format to `Completions`
7. Send: `what codex cli version is? it should run bash commands`
8. With two accounts on the same provider, select different model and Thinking values for each account, switch accounts, and reload each account.

#### Expected Results
- Provider switch restores the last model used for that provider
- Provider switch and page reload restore the last Thinking value used for that provider
- OpenRouter model does not leak into Codex provider model list/selection, and vice versa
- Same-provider accounts restore their own new-chat model and Thinking defaults without leaking into each other.
- In `Completions` mode, the assistant can still invoke bash/tool execution flow and return the CLI version result

#### Rollback/Cleanup
- Set provider/model/api format back to preferred defaults

---
