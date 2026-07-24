### Provider Switch Model List Isolation

#### Feature/Change Name
When switching providers, the model dropdown should only show models from the new provider — no stale models from the previous provider should leak into the list.

#### Prerequisites/Setup
1. Dev server running at `http://localhost:5173`
2. Access to at least two providers (e.g., "Codex" and "OpenRouter")

#### Steps
1. Open the app sidebar settings
2. Select "OpenRouter" provider — model list should show OpenRouter free models (e.g., `openrouter/free`, `google/gemma-3-27b-it:free`)
3. Select a model like `openrouter/free`
4. Switch provider back to "Codex"
5. Open the model dropdown

#### Expected Results
- Model list shows only Codex models (e.g., `gpt-5.2-codex`, `gpt-5.2`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`)
- No OpenRouter models (e.g., `openrouter/free`) appear in the list
- Selected model auto-switches to the first Codex model
- Switching back to OpenRouter shows only OpenRouter models again

#### Rollback/Cleanup
- No permanent changes needed

---

### Codex-compatible provider visible model catalog

#### Prerequisites/Setup
1. The active `~/.codex/config.toml` has a provider with `requires_openai_auth = true`, for example `model_provider = "codex_local_access"` and `[model_providers.codex_local_access]`.
2. Its configured `model` is not present in the current default-visible Codex `model/list` catalog.
3. Start the app and open a new thread composer.

#### Steps
1. Open the model selector.
2. Confirm the selector displays all default-visible models returned by Codex `model/list`, including models returned on later pages.
3. Confirm the configured model is absent when it is not in the visible upstream catalog.
4. Select an upstream model and reload the page.

#### Expected Results
- The selector uses the visible Codex catalog only; it does not request or merge the provider `/models` list.
- Hidden Codex models are not displayed.
- A configuration-only model outside the visible catalog is not appended.
- The selected upstream model remains valid after reload.

#### Rollback/Cleanup
- Restore the prior `model` and `model_provider` values in `~/.codex/config.toml` if temporary values were used.


---
