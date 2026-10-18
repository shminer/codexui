### Feature: Per-thread model selection

#### Prerequisites
- App is running from this repository against a Codex app-server that supports thread-scoped model persistence.
- At least two selectable models are available in the composer model picker.
- At least one existing thread is available, or you can create one during the test.

#### Steps
1. On the new-thread screen, choose model `A` in the composer.
2. Send a message to create a new thread.
3. In that thread, switch the composer model to model `B`.
4. Send another message in the same thread so the thread persists model `B`.
5. Create or open a different thread and set its model to model `A`.
6. Switch back and forth between the two threads.
7. Refresh the browser while one of the threads is selected.
8. Re-open both threads again after the refresh.
9. While thread `A` is selected, use the sidebar thread menu to fork thread `B`.
10. Open the forked thread and confirm the composer model matches thread `B`, not the currently selected thread.
11. Restart the app-server or otherwise force a model-list refresh that does not include one thread’s persisted model, then switch back to that thread.
12. Delete one of the test threads you changed, refresh the thread list, and continue switching between the remaining thread and the new-thread screen.
13. On Windows, start the current checkout on `http://127.0.0.1:4173` and run `node scripts/verify-model-refresh.cjs`. The script uses isolated browser contexts with mocked RPC and accounts; no real provider settings or chats are changed.
14. Inspect `output/playwright/model-refresh-results.json` and `model-refresh-*-cjs.png`. These cover a new conversation, an existing conversation, legacy saved Thinking preferences, an empty provider model list, and a failed model-list request. Each case selects a different model and High/Ultra before reloading.

#### Expected Results
- Each thread restores its own last selected model when you switch threads.
- The new-thread screen keeps its own draft model selection instead of inheriting the last opened thread.
- After browser refresh, reopening a thread restores the model persisted for that thread.
- Forked or newly created threads keep the resolved model returned by Codex, including fallback to the supported default model when needed.
- Forking a nonselected thread from the sidebar uses that source thread’s persisted model.
- If the selected thread’s persisted model is not returned in the latest model list, the composer still shows that model as the active selection instead of falling back to the placeholder label.
- Removing a thread prunes its saved per-thread model state, and model selection continues to update normally for the remaining threads without runtime errors.
- Refresh preserves the chosen model and Thinking level in all five mock scenarios. The active account/provider preference takes precedence over legacy new-chat Thinking state. A transient empty or failed model catalog must not erase the saved selection; a successful nonempty catalog still filters unavailable new-chat models.
- Light and dark screenshots show the actual composer after refresh. The JSON report records storage before/after, visible picker labels, browser errors, and reload RPC calls. Normal reloads request config/model metadata once each; this fix adds no requests or retries.

#### Rollback/Cleanup
- Reset each tested thread back to its original model selection if you changed an existing conversation for the test.
- The automated check closes its isolated contexts. Reports and screenshots remain under ignored `output/playwright/`; leave the verification server running.
