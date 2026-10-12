### Thread conversation loads earlier turns on demand

#### Feature/Change Name
Thread conversation incremental older-turn loading.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. A thread with more than 10 turns is available
3. Light theme and dark theme both available from the appearance switcher
4. For the oversized-turn case, a saved thread with at least 50 turns and one middle turn exceeding the 2 MiB estimated text budget

#### Steps
1. In light theme, open a thread that has more than 10 turns.
2. Confirm the newest messages render first and the conversation shows the Load earlier messages control at the top.
3. Click Load earlier messages once.
4. Confirm an older batch is prepended above the previously first visible turn and the scroll position stays near the same content.
5. Continue clicking Load earlier messages until the control disappears.
6. Confirm the oldest messages in the thread are visible and no duplicate message rows are introduced.
7. Switch to dark theme and repeat steps 1-6 on the same thread or another long thread.
8. Continue through enough pages to exceed 20 turns. Confirm the distant newer end is unloaded and a newer-history control is available.
9. Load newer history repeatedly. Confirm no gaps or duplicate messages, and verify turn actions still refer to the original turn IDs.
10. Read older history while the thread receives new output. Confirm silent refreshes do not replace the reading window with the newest messages.
11. Click Jump to latest. Confirm a successful request replaces the reading window; simulate a failure and confirm the old content remains visible.
12. Repeat historical navigation in an archived-thread preview and an agent-detail panel. Confirm they use the same bounded behavior.
13. In the oversized-turn thread, navigate from the latest window to the oldest window and then back to the latest. Record the visible turn IDs on each step. Confirm the oversized turn appears intact in both directions, occupies its own ordinary window, and allows continued navigation on either side.
14. Load a final newer page containing an oversized middle turn. If the page is only partly displayed, confirm the newer-history control stays available. Allow a background refresh, confirm it preserves the reading window, and load the remaining newer history.
15. Repeat steps 13-14 in the archived-thread preview and agent-detail panel, including a page containing raw turns with no displayable messages. Confirm each click advances the raw cursor rather than repeatedly requesting the same empty page.
16. With only turn C retained, delay a refresh that returns turns A, B and C. Release the response and confirm the restored order is A, B, C, with one row per message ID and the server item order within each turn.
17. During delayed detail and latest-page requests, stream more text for an existing reply and command output for an existing command. Release a shorter snapshot, then send another delta and completion. Confirm text/output does not regress, later deltas use the restored prefix, and each ID stays in its original position.
18. Start a new turn with a running command and reasoning while an older idle detail response is delayed. Release the response and confirm the new turn remains running, with its command, reasoning and queued/pending send intact.
19. Retain an older question, send the same question again, and release a snapshot containing only the older turn. Confirm the pending send remains running with Thinking rather than being cleared by the old response; the main send path does not create an extra optimistic body row. Separately, restore a snapshot over a pending optimistic user row and confirm only its own persisted user turn replaces it, not an older same-text question.
20. Repeat steps 16-19 in light and dark themes. Switch to another thread and reopen a retained history window; confirm one shared latest request completes before following resumes. A same-thread background wake must preserve history instead of jumping.
21. Delay or fail body sync until completed replies A and C both remain in live state. Return a snapshot containing both, with each reply about 600,000 characters so the text budget only fits C. Confirm only C remains, A is not appended after C, and repeated silent/latest reads do not restore A from live state.
22. Restore a running remote reply C without a local pending send. Load earlier A and keep both within the budget, then read A while C receives enough same-ID text to exceed the combined budget. Confirm the history body and reading anchor remain unchanged. Explicitly return to latest and confirm the full updated C appears once within the existing retention policy.
23. Restore reply C, a running command and a plan in the newest turn, then load earlier A. Stream same-ID text, command output and plan deltas while reading A. Load newer history to its final boundary, including the case where the exclusive cursor returns no rows. Confirm each ID appears once with its updated content. Repeat with a nonempty final page and with an intermediate page that still has newer history; intermediate pages must keep the frozen reading content and hidden updates.
24. While reading the history window from step 23, complete the restored command and its turn. Allow an idle background sync before loading the final newer page. Confirm the old reading row remains unchanged until history mode ends, then displays the completed output/status/exit code once. Command cleanup must retain only updates to command IDs still in the reading window.
25. For the intermediate-newer-page live-baseline repair, keep reading older history while a later turn R has reply, command and plan prefixes `a` in hidden live state. Return an intermediate newer page covering those same IDs with prefixes `abc` and `hasMoreNewer: true`. Send a new `d` delta to each, then return an empty final newer page. Confirm all three show `abcd` once after leaving history, not `ad`; the paging cursor advances from the previous boundary to turn R. Repeat with reply replacement, command completion and a plan delta arriving during the delayed intermediate request: those newer updates must survive the response and remain the baseline for the following delta. Run on PC and mobile in both themes using disposable mock data; leave unrelated anchor-turn updates untouched.

26. For the pre-read newer-page protection repair, use disposable mock data with a hidden reply and plan already at `abc` before requesting newer history. Return a stale intermediate page with the same IDs at `a`, with no notifications during the request. Confirm the live baseline remains `abc`; send `d`, then return an empty final page and confirm `abcd` appears once. Repeat with a stale final page. Include commands whose local output cursor is ahead, whose cursor is equal but retained output tail is longer, and whose local status is completed while the snapshot says inProgress: preserve the fuller output, offset, total length, terminal status and exit code. Also return a shorter non-prefix reply replacement (`draft answer` to `done`) and confirm it is accepted and the next delta uses `done`. Run on PC/mobile in light/dark themes; use the existing delayed-response setup and cleanup steps.
27. Scroll to the newer-history control while the floating Jump to latest button is visible. Delay the final page response and confirm the paging button remains above, not underneath, the floating button. Repeat at 1440x1000, 768x1024 and 375x812 in both themes. At 768px, collapse the left sidebar before opening the agents sidebar so the existing minimum conversation-width rule permits expansion. Open a running agent whose snapshot is ahead of its live prefix; send another delta and confirm its reply appears once with the snapshot prefix intact.
28. For the layout-induced reverse-pagination repair, open a saved long thread with large middle turns and different page heights. Repeatedly click Load earlier messages through a page that evicts the old visible anchor and shortens the scroll container. Inspect `/codex-api/thread-turn-page` requests: no `afterTurnId` request may follow automatically while navigating earlier, and repeated clicks must reach the oldest turn rather than cycle between the same cursors. Reverse using Load later messages and reach the latest turn. Also wheel upward/downward near each edge to confirm automatic paging follows the actual scroll direction. Repeat in light and dark themes; do not send new turns, edit or delete the saved conversation.

#### Expected Results
- Initial thread open remains bounded to the latest turn page.
- Load earlier messages fetches older persisted turns from the local bridge instead of only revealing already-loaded messages.
- The control remains available while older persisted turns exist and disappears after the first turn is loaded.
- Message ordering, turn actions, and scroll restoration remain stable in light and dark themes.
- The active ordinary window retains at most 20 complete turns with a 2 MiB estimated text target. One oversized turn and protected unpersisted/approval content may exceed the target.
- Non-active ordinary body caches are limited to the three most recently used threads, each up to 10 turns and 512 KiB. Metadata, unread state and pending work are independent of body eviction.
- A stale turn anchor returns an explicit error rather than falsely indicating the end of history. Retrying preserves the selected paging direction.
- Paging starts with the incoming turn nearest the current cursor. A large middle turn is never skipped to fill the window with smaller turns farther away.
- The newer-history control and reading mode remain active while budget trimming leaves undisplayed turns, even when the server page reports no later page.
- Snapshot restoration follows authoritative server turn indices and item order. Locally newer same-ID content survives delayed responses without duplicate rows or text-based sorting; older/newer paging continues to use its original direction.
- Restored command output remains limited to the 64 Ki character tail with total length/offset metadata. Reply and command deltas retain the existing 50 ms batch interval after restoration.
- Delayed idle snapshots do not clear a newer lifecycle or pending send. Explicit thread reopening restores latest, while background refresh and same-thread wakes preserve an active history window.
- At the final newer boundary, hidden updates are merged into the retained body before history mode ends. Budget trimming that leaves newer turns undisplayed keeps history mode active. Completed anchor-command updates survive idle sync until this merge.
- Every newer page rebases only its covered live IDs, protecting updates received during that read. Later deltas use the reconciled prefix even before the final page; unrelated hidden rows, complete-turn retention and command output limits remain unchanged.
- A stale newer page also preserves compatible fuller prefixes and command progress already present before the request. Equal-cursor command output keeps the fuller bounded tail; legitimate shorter non-prefix reply replacements remain accepted.
- The newer-history footer reserves 80px below its button for the floating Jump to latest control; the controls do not overlap on desktop, tablet or mobile.
- Page-height changes and anchor restoration do not trigger pagination toward the opposite edge. Scroll-triggered paging follows the reader's movement; explicit earlier/later controls remain available for pages too short to scroll.

#### Verification Boundary
- The original snapshot-recovery verification used explicitly requested mocks and UI screenshots, without a build, publish or production-history mutation.
- The reverse-pagination case was reproduced on an existing Windows conversation. Before the repair, earlier navigation caused automatic newer-page reads and repeated cursors. After the repair, both directions reached their boundaries with 17 distinct cursors each and no opposite-direction requests, history errors or page errors. Light/dark screenshots use 1440x1000 at `http://127.0.0.1:4173/#/thread/01a105e6-0b2e-7342-9959-3407f2bdf1a9`; evidence is under `output/playwright/real-thread-history-*`, with the read-only runner `output/playwright/verify-real-thread-history.cjs`. Builds are permitted in this verification session; the saved conversation was not sent to, edited, rolled back or deleted.
- Focused mock suite: 273/273 passed across desktop state, retention, history windows, subagent state/wiring and conversation-window wiring. This includes the regression cases for steps 23-26 and the footer-space assertion. Evidence: `output/playwright/snapshot-recovery-focused-unit.json`.
- Playwright: seven scenarios passed, covering the three viewports above in both themes with stale intermediate snapshots, plus a desktop snapshot-ahead case. Assertions check unique ordered IDs, reply/plan prefixes, command output cursor/tail/terminal state, final-page synchronization, subagent snapshot/delta recovery, footer geometry and absence of horizontal page overflow. Evidence: `output/playwright/snapshot-recovery-acceptance.json`; runner: `output/playwright/snapshot-recovery-acceptance.cjs`; screenshots: `output/playwright/snapshot-recovery-*-{pagination,main,agent}.png`.
- Full unit suite: 796/798 passed. The remaining failures are the old `Codex Web` feedback-subject assertion in `useFeedbackDiagnostics.test.ts` and a missing fallback file-change timestamp in `codexAppServerBridge.inlinePayload.test.ts`. Neither file nor its implementation changed in the latest three recovery commits. These independent failures were left outside this UI verification repair. Evidence: `output/playwright/snapshot-recovery-unit.json`.
- `pnpm exec vue-tsc --noEmit` and `git diff --check` passed. Browser evidence is disposable mocked data; real long-duration background suspension, production-sized payloads and heap-retention measurements remain unverified.
- Performance boundary: the footer fix adds only a CSS class and padding, with no new request, watcher, cache or rendering loop. The mock runner asserts each newer cursor is requested once and records API bytes and browser long tasks; its small fixtures are not a production load benchmark.

#### Rollback/Cleanup
- Closing the preview or switching threads releases disposable body caches; reopening reloads saved history. No source conversation is removed.
- Release delayed mock responses and stop synthetic streaming before cleanup; restore the original theme and route. The test does not edit stored conversation history.

---
