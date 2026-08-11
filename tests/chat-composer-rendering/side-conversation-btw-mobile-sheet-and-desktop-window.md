# Side conversation `/btw` mobile sheet and desktop window

## Feature / Change

The composer voice-input control is replaced by a temporary side-conversation button. A side conversation snapshots the parent thread model and Thinking value when it is created, remains scoped to the current main thread, and restores from the same browser tab after refresh.

## Prerequisites

- Start the app from this repository with a Codex CLI version that supports `thread/fork`, `thread/inject_items`, `turn/interrupt`, `thread/archive`, and `thread/unsubscribe`.
- Open a persisted thread that already contains at least one completed user turn.
- Keep the thread list and browser DevTools Network panel visible when checking RPC behavior.
- Prepare desktop and mobile-sized viewports, plus both light and dark app themes.

## Desktop Floating Window

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Open an existing thread on a desktop viewport. | The composer action row shows the side-conversation icon, and Settings contains no controls for the removed input feature. |
| 2 | Click the side-conversation icon. | One floating window opens at the lower-right without blocking the main conversation. Its header shows `Side conversation`, `End chat`, and a close button. |
| 3 | Open the side window before a newly selected parent finishes restoring, then inspect RPC requests. | The app waits for the parent restore, then sends `config/read`, `thread/fork`, and `thread/inject_items`. The fork uses the restored parent model, runtime provider ID, Thinking value, `excludeTurns: true`, and `persistExtendedHistory: true`; it does not send `ephemeral` or the unsupported `sideConversation` field. |
| 4 | Send a side question and wait for the response. | The user message, live activity, and final response render inside the floating window. The main thread transcript and composer draft remain unchanged. The side window exposes no model or Thinking selector; subsequent turns use the values captured in step 2. |
| 5 | Disable `Send with Enter`, type a question, press Enter, then press Command+Enter or Ctrl+Enter. Re-enable the setting and repeat with Enter and Shift+Enter, including while an IME candidate is active. | The side composer follows the same global shortcut as the main composer: plain Enter inserts a line when disabled, the platform modifier sends, plain Enter sends when enabled, Shift+Enter inserts a line, and IME confirmation never submits. |
| 6 | Briefly disconnect the upstream API while a side response is running, then allow its normal retry to recover. | The side window shows the reconnect state, clears it on the next side event, and continues the same side conversation. |
| 7 | Switch between light and dark themes. | The panel, header, input, buttons, error surface, and message area remain readable with no light surface left on the dark page. |
| 8 | Switch to another main thread or return to the home page. | The side window closes immediately and the side child is interrupted, archived, and unsubscribed in the background. The new main thread stays selected. |

## Mobile Bottom Sheet

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Repeat the flow at `375x812`. | The side conversation opens as a bottom sheet with a backdrop, a visible drag handle, stable full width, and no text or controls outside the viewport. |
| 2 | Enter a multiline question with `Shift+Enter`, then send it. | The input grows only within its bound, the sheet does not shift width, and the message is sent once. |
| 3 | Open the mobile keyboard and receive a long response. | The message list remains scrollable, the input and action button remain reachable, and content does not overlap the close button. |
| 4 | Verify both light and dark themes. | The bottom sheet and backdrop preserve contrast and all controls remain visible. |

## Close And Cleanup

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | While a side response is running, click the desktop close button or mobile backdrop. | The side window hides only. The child ID, transcript, draft, pending request, and active side turn remain unchanged; no interrupt or unsubscribe request is sent. |
| 2 | Click the side-conversation icon again after hiding. | The original side window reopens with the same transcript and draft; no second `thread/fork` is sent. |
| 3 | While a side response is running, click `End chat`. | The UI clears immediately. The app rejects pending side requests, interrupts the active side turn after a pending `turn/start` returns its ID, then archives and unsubscribes the child in the background. |
| 4 | Open an idle side conversation and click `End chat`. | The UI clears immediately, sends `thread/archive` and `thread/unsubscribe`, and does not send an empty `turn/interrupt`. |
| 5 | Refresh while the side window is visible, then refresh again while it is hidden. | The same-tab page restore resumes the same child transcript and active turn. Visible state and unsent draft are preserved in both cases, and the child never appears in the main thread list. |
| 6 | Switch to another main thread or account after opening or hiding a side conversation. | The side conversation ends, its session record clears, and reopening creates a new empty side child. |
| 7 | Refresh with a stale child thread ID. | The stale session record clears and no empty side conversation is created automatically. |
## Rollback / Cleanup

- Close any side window created during the check.
- Confirm no temporary side child is visible in the thread list after cleanup completes.
- Return the viewport and app theme to their previous settings.
