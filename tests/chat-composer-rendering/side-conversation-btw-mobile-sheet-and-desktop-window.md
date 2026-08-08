# Side conversation `/btw` mobile sheet and desktop window

## Feature / Change

The composer voice-input control is replaced by an ephemeral side-conversation button. The side conversation inherits the parent thread context, uses the official `/btw` fork lifecycle, and is discarded when closed.

## Prerequisites

- Start the app from this repository with a Codex CLI version that supports `thread/fork.ephemeral`, `thread/inject_items`, and `thread/unsubscribe`.
- Open a persisted thread that already contains at least one completed user turn.
- Keep the thread list and browser DevTools Network panel visible when checking persistence and RPC behavior.
- Prepare desktop and mobile-sized viewports, plus both light and dark app themes.

## Desktop Floating Window

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Open the existing thread on a desktop viewport. | The composer action row shows the side-conversation icon, and Settings contains no controls for the removed input feature. |
| 2 | Click the side-conversation icon. | One floating window opens at the lower-right without blocking the main conversation. Its header shows `Side conversation` and a close button. |
| 3 | Open the side window before a newly selected parent finishes restoring, then inspect RPC requests. | The app waits for the parent restore, then sends `config/read`, an ephemeral `thread/fork`, and `thread/inject_items`. The fork uses the restored parent model and runtime provider ID together and includes `excludeTurns: true`; the injected item is the hidden side boundary. |
| 4 | Send a side question and wait for the response. | The user message, live activity, and final response render inside the floating window. The main thread transcript and composer draft remain unchanged. Only one `turn/start` is sent for the side question. |
| 5 | Start a normal main-thread turn, then open the side conversation while that turn is still running. | The side window opens and can exchange messages while the main turn continues independently. |
| 6 | Disable `Send with Enter`, type a question, press Enter, then press Command+Enter or Ctrl+Enter. Re-enable the setting and repeat with Enter and Shift+Enter, including while an IME candidate is active. | The side composer follows the same global shortcut as the main composer: plain Enter inserts a line when disabled, the platform modifier sends, plain Enter sends when enabled, Shift+Enter inserts a line, and IME confirmation never submits. |
| 7 | Switch between light and dark themes. | The panel, header, input, buttons, error surface, and message area remain readable with no light surface left on the dark page. |

## Mobile Bottom Sheet

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Repeat the flow at `375x812`. | The side conversation opens as a bottom sheet with a backdrop, a visible drag handle, stable full width, and no text or controls outside the viewport. |
| 2 | Enter a multiline question with `Shift+Enter`, then send it. | The input grows only within its bound, the sheet does not shift width, and the message is sent once. |
| 3 | Open the mobile keyboard and receive a long response. | The message list remains scrollable, the input and action button remain reachable, and content does not overlap the close button. |
| 4 | Verify both light and dark themes. | The bottom sheet and backdrop preserve contrast and all controls remain visible. |

## Close And Ephemeral Cleanup

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | While a side response is running, click the close button. | The app sends `turn/interrupt` for the active side turn, followed by `thread/unsubscribe`; the panel closes after cleanup. |
| 2 | Open another side conversation, wait for an idle response, and close it. | The app sends `thread/unsubscribe` directly without an empty `turn/interrupt`. |
| 3 | Let a known side turn finish immediately before its interrupt reaches the app-server, then close it. | A `no active turn to interrupt` response is treated as an already completed turn and cleanup continues with `thread/unsubscribe`; other interrupt or unsubscribe failures keep the panel open for retry. |
| 4 | Fail `thread/unsubscribe` after a successful interrupt, then retry the explicit close. | The retry sends only `thread/unsubscribe`; it does not interrupt the completed turn again. |
| 5 | Let the side turn stop on an approval or user-input request, then close or navigate away. | The app replies to each side request with a cancellation error before cleanup; no hidden bridge request remains to block account actions. |
| 6 | Inspect the thread list, then reload the page. | No successfully discarded side-conversation thread appears in the thread list before or after reload, and no side messages return. |
| 7 | Open a side conversation and navigate to another main thread or Home. | The side panel closes immediately; interrupt and unsubscribe continue as best-effort background cleanup instead of following the new route. An in-flight explicit cleanup is reused instead of duplicated. |
| 8 | Close two side conversations, then deliver a late error or approval request for the first one. | The old notification does not appear in the current conversation, global error surface, or pending-request UI; a late request receives a cancellation reply. |
| 9 | Reopen a side conversation on the original parent. | A new empty side window opens; the prior side transcript and draft are absent. |
| 10 | Throttle the pending-request endpoint, reconnect the notification stream while its startup snapshot is loading, then refresh the account before a conflicted snapshot resolves. | The `ready` recovery reuses the in-flight snapshot, and the account refresh's polling restart prevents the old snapshot from scheduling another request or updating the new polling cycle. |

## Rollback / Cleanup

- Close the side conversation with its header close button.
- Confirm no temporary side thread remains in the thread list.
- Return the viewport and app theme to their previous settings.
