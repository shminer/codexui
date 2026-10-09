# Side conversation `/btw` mobile sheet and desktop window

## Feature / Change

The composer voice-input control is replaced by a temporary side-conversation button. A side conversation snapshots the parent thread model and Thinking value when it is created, remains scoped to the current main thread, survives minimization, and ends from X or when the original page closes. Its transcript uses bounded browser memory and temporary server memory; draft, selections, completion statistics, and queue remain in browser memory. Pop-out moves the same instance into a new window; it depends on the original page remaining open.

## Prerequisites

- Start the app from this repository with a Codex CLI version that supports ephemeral `thread/fork`, `thread/inject_items`, `turn/interrupt`, and `thread/unsubscribe`.
- Open a persisted thread that already contains at least one completed user turn.
- Keep the thread list and browser DevTools Network panel visible when checking RPC behavior.
- Prepare desktop and mobile-sized viewports, plus both light and dark app themes.

## Desktop Floating Window

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Open an existing thread on a desktop viewport. | The composer action row shows the side-conversation icon, and Settings contains no controls for the removed input feature. |
| 2 | Click the side-conversation icon. | One floating window opens at the current lower-right default size and position without blocking the main conversation. Its header shows pop-out, minimize and X controls. |
| 3 | Open the side window before a newly selected parent finishes restoring, then inspect RPC requests. | The app waits for the parent restore, then sends `config/read`, `thread/fork`, and `thread/inject_items`. The fork uses the restored parent model, runtime provider ID, Thinking value, `ephemeral: true`, and `excludeTurns: true`; it does not send `persistExtendedHistory` or the unsupported `sideConversation` field. |
| 4 | Send a side question and wait for the response. | The side transcript starts empty and renders only this side turn, including its message times, live activity, commands, file changes, and final response. The model can still use the parent conversation as context, but inherited parent turns never appear in the side window. The main transcript and composer draft remain unchanged. |
| 4a | While the side model is thinking, choose Steer and send another message; then choose Queue and send one more. | The steered message appears after the current live activity instead of above it. The queued message stays in the side queue until its turn starts, without appearing in the main transcript or sending a second immediate `turn/start`. |
| 4b | In the side composer, choose a model, Thinking level, mode, and skill, then send. | The side turn uses those selections. Changes do not alter the main composer selection; the side composer shows no nested side-conversation button. |
| 4c | Type a draft, select a skill and attachment, then receive and answer an approval or user-input request. | The composer hides during the request and restores the same draft, skill and attachment afterward. |
| 4d | Queue two messages, then edit a main-chat queue or trigger a main-chat refresh. Complete the side turn, deliver a repeated completion notification, and interrupt the next side turn. | Main-chat operations neither save nor erase the side queue. Successful completion starts exactly one queued message. Duplicate completion starts no extra turn; interruption leaves remaining queued messages intact. |
| 4e | Send Steer during live output, then allow the server to confirm the user item and finish the turn. Start another side turn. | The confirmed steer remains after live output while that turn runs. After completion it follows the server's history order and does not move below later turns. |
| 5 | Disable `Send with Enter`, type a question, press Enter, then press Command+Enter or Ctrl+Enter. Re-enable the setting and repeat with Enter and Shift+Enter, including while an IME candidate is active. While a side turn runs with Queue selected, use the modifier shortcut with a draft, then with an empty composer and two queued messages. | The side composer follows the same global shortcut as the main composer: plain Enter inserts a line when disabled, the platform modifier always Steers the current draft, plain Enter sends with the selected mode when enabled, Shift+Enter inserts a line, and IME confirmation never submits. With an empty composer the shortcut Steers only the first queued message. |
| 6 | Briefly disconnect the upstream API while a side response is running, then allow its normal retry to recover. | The side window shows the reconnect state, clears it on the next side event, and continues the same side conversation. |
| 7 | Switch between light and dark themes. | The panel, header, input, buttons, error surface, and message area remain readable with no light surface left on the dark page. |
| 8 | Switch to another main thread or return to the home page. | The side window closes immediately and the side child is interrupted when active, then unsubscribed in the background. The new main thread stays selected. |
| 9 | Drag the desktop header, then resize from the lower-right handle toward both minimum and viewport limits. Tab to the resize handle and repeat with the four arrow keys. | Pointer and keyboard resizing keep the window inside the visual viewport, expose the current size to assistive technology, and reflow the transcript and composer without overlap. |

## Mobile Bottom Sheet

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Repeat the flow at `375x812`. | The side conversation opens as a bottom sheet with a backdrop, a visible decorative handle, stable full width, no desktop resize handle, and no text or controls outside the viewport. |
| 2 | Enter a multiline question with `Shift+Enter`, then send it. | The input grows only within its bound, the sheet does not shift width, and the message is sent once. |
| 3 | Open the mobile keyboard and receive a long response. | The message list remains scrollable, the input and action button remain reachable, and content does not overlap the minimize or X controls. |
| 4 | Verify both light and dark themes. | The bottom sheet and backdrop preserve contrast and all controls remain visible. |
| 5 | In a mobile browser at `375x812`, type a draft and queue a message, then open the side chat in a new window. Inspect model, skills and Thinking menus, send, then close the new tab. Repeat in dark theme. | The new tab uses the device-width viewport and fills the screen without desktop-page shrinking or horizontal scrolling. Menus fit the mobile viewport; selections and sending work, and closing returns the same draft and queue to the original page. |

## Minimize And Cleanup

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | While a side response is running, click minimize or the mobile backdrop. | The window hides without interrupting or unsubscribing the child; the response continues in memory. |
| 2 | Click the side-conversation icon after minimizing. | The same child, transcript, draft, selected model and skills, queue, response state, desktop size, and desktop position return without another `thread/fork`. |
| 3 | While a side response is running, click X. | The UI clears immediately, rejects pending requests, interrupts after a pending `turn/start` returns its ID, then unsubscribes the child in the background. |
| 4 | Open an idle side conversation and click X. | The UI clears immediately, sends `thread/unsubscribe`, and does not send an empty `turn/interrupt` or `thread/archive`; reopening creates a new empty child. |
| 5 | Refresh while the side window is open, including immediately after sending a message. | The page sends one best-effort keepalive discard request. The server reads the current active turn, interrupts it when present, then unsubscribes in order. After reload, no child ID, transcript, draft, model, or Thinking state is restored. |
| 6 | Switch to another main thread or account after opening a side conversation. | The side conversation ends, and reopening creates a new empty ephemeral child. |
| 7 | Inspect the main thread list before and after closing or refreshing. | The ephemeral child never appears in the persistent thread list. |

## Pop-out Window

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | With a draft and queue present, click Open in new window in the header. | The same transcript, live turn, draft and queue move into a full-window view; no extra fork, resume, notification subscription, or storage write occurs. |
| 2 | Select a model and skill in the popped-out composer, send a message, then switch the original page theme. | Menus appear and respond in the popup. The payload includes the selections; both documents use the same theme. |
| 3 | Close or refresh the popup. | The same instance returns to the original page with its draft and queue intact. |
| 4 | End the side conversation or close/refresh the original page while popped out. | The temporary conversation ends. Ending it closes the popup, and refreshing the original page restores no side state. |
| 5 | Block popups and click Open in new window. | The original side conversation stays usable with its draft and queue intact. |

## Rollback / Cleanup

- Close any side window created during the check.
- Confirm no temporary side child is visible in the thread list after cleanup completes.
- Return the viewport and app theme to their previous settings.

## Shared Chat Width And Edit Message

- Setup: open a parent thread and side conversation; prepare light/dark themes and desktop/mobile viewports.
- Adjust Settings > Chat width while the floating side window is open, then pop it out and adjust again. Minimize and restore; reload the parent, reopen a side conversation, and repeat.
- Expected: transcript, user bubbles and composer share the main width preference, constrained by the available window. The outer floating window still resizes independently.
- Click Edit message on a side user message with an empty draft and with an existing draft. Repeat while a response runs and in the popup.
- Expected: text is appended to the side draft and focused; main draft and historical messages are unchanged. Existing attachments, skills and queue remain. No rollback or automatic send occurs.
- During opening or a pending approval/input request, the edit action is absent. Agent and archived read-only previews still have no edit action, and side Fork/file undo controls remain absent.
- Cleanup: close the side conversation and restore the width preference. This change was statically checked only; browser checks remain pending under the session restrictions.

### Ephemeral synchronization regression

- Setup: current CLI with ephemeral forks; open a parent conversation and the browser network inspector.
- Send two side turns, steer during the first, and reconnect the notification stream. Finish or stop the turn, then start another.
- Expected: lifecycle synchronization uses `thread/read` with `includeTurns:false`, never `thread/resume` or native full history. Transcript pages use `/codex-api/thread-turn-page?source=ephemeral` and read only the temporary server cache. No `no rollout found` or `ephemeral threads do not support includeTurns` error. A lost runtime thread asks to reopen the temporary conversation.
- Close the side window or reload the parent. Expected: the active turn is interrupted when its ID is known, then the child is unsubscribed. No transcript or side queue is saved. Empty side queues trigger no background history reads/retry timers.
- Cleanup: close the temporary child; no persistent test session is needed.
- Performance: one metadata read per coalesced lifecycle sync, one coalesced temporary-cache read on visible completion/restoration, and no history polling for minimized threads. No live long-duration throughput measurement was performed.

- Reorder fixture delivery so idle metadata precedes the final assistant item, and so running metadata arrives after turn completion. Expected: one final reply, no restored Thinking state. Replay of a final item updates the same in-memory ID. Each render deduplicates side rows in linear time; no extra request is needed.

- Reload while `turn/start` is pending: teardown waits for the server-side start to settle and uses its active turn ID before unsubscribing. This adds no history read and does not rely on the departing browser receiving the start response.

## Temporary Server History Cache

| Item | Actions | Expected result |
| --- | --- | --- |
| Setup | Use an ephemeral-capable CLI; open a side conversation and DevTools Network. | The child stays absent from persistent history and the cache contains only new child turns, not inherited parent turns or boundary injection. |
| Paging | Produce at least 25 side turns, request earlier/later/latest pages with `source=ephemeral`. | Exclusive turn anchors page the same child; these routes issue no native history RPC. |
| Limits | Produce over 100 turns, more than 8 MiB of retained source data, or exceed the global 32 MiB cache budget across tabs. | Older turns/items or least-recently-used caches are released. Expired sources return 410; evicted anchors return 409. A single oversize item is omitted rather than retained beyond budget. |
| Expiration | Leave a child idle without cache reads for 30 minutes. Resume with a new turn. | The old cache expires; the new turn creates a fresh bounded cache marked as truncated. Later child events never enter the ordinary persisted-item cache. |
| Policy | Deny `thread/read` for page requests and `thread/items/list` for source requests using the injected policy. | Requests return 403 before reading the cache, preserving the existing route/RPC checks. |
| Cleanup | End the side conversation; deliver a late completed-item event. | Cache and active registration are released; recent closed-child events are ignored. Process disposal clears all temporary caches. Up to eight live temporary children are admitted per app-server process. |

## Browser Transcript Budget And Minimize

| Item | Actions | Expected result |
| --- | --- | --- |
| Setup | Prepare desktop, 375x812 and 768x1024 viewports; repeat in light/dark themes. Generate over 20 turns, a response over 256 Ki characters and command output over 64 Ki characters. | Side assistant text, command output and reasoning deltas use the existing 50 ms batch path; completion/idle synchronization flushes pending content first. |
| Retention | Continue sending while observing browser state and heap snapshots. Include a single turn with many commands. | Visible transcript retains at most 20 turns, 1000 items and an estimated 2 MiB text budget including live content and reasoning. A single huge turn is cropped by item, not exempted. |
| Output | Expand a long completed command; page earlier/later output and copy full output. | State stores only the latest 64 Ki characters plus offset/total metadata. Older output and full copy read the temporary source only when requested. |
| Text | Edit/copy a truncated user message and copy a truncated assistant response. Then expire the source and repeat. | A truncated marker is shown. Successful actions use the full source; an expired/running source shows an error without editing the draft or copying the preview as full content. |
| Minimize | Keep a draft, skill, attachment and queued messages; minimize while running. | Only the transcript component unmounts. Its render caches/timers are cleared. Browser transcript drops to 10 turns and an estimated 512 KiB budget; draft, queue, selections and child execution remain. |
| Restore | Open the same side window, then pop it out and return. | Same child, no fork/resume/new subscription; restoration coalesces one latest-cache read. Width preference stays synchronized. |
| Races | Delay a history request; finish another turn or close the side window before returning the response. | Newly arrived rows survive the delayed response; closed state stays cleared. Stale anchors recover latest once, and expired caches stop pagination while keeping the remaining preview. |
| Cleanup | End the child and restore viewport/theme/width settings. | Pending deltas, window bounds, indices, queue and cache references are released. No side transcript/draft is persisted in localStorage. |

Static verification only: runtime/mock tests, heap measurements and browser/theme acceptance were not executed under the session restrictions. Server source budgets are additional to the existing ordinary-thread cache budget; draft/attachment/queue memory is intentionally outside transcript retention.
