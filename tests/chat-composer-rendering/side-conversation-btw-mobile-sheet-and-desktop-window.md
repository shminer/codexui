# Side conversation `/btw` mobile sheet and desktop window

## Feature / Change

The composer voice-input control is replaced by an ephemeral side-conversation button. A side conversation snapshots the parent thread model and Thinking value when it is created. It is not restored after refresh.

## Prerequisites

- Start the app from this repository with a Codex CLI version that supports `thread/fork.ephemeral`, `thread/inject_items`, `turn/interrupt`, and `thread/unsubscribe`.
- Open a persisted thread that already contains at least one completed user turn.
- Keep the thread list and browser DevTools Network panel visible when checking RPC behavior.
- Prepare desktop and mobile-sized viewports, plus both light and dark app themes.

## Desktop Floating Window

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Open an existing thread on a desktop viewport. | The composer action row shows the side-conversation icon, and Settings contains no controls for the removed input feature. |
| 2 | Click the side-conversation icon. | One floating window opens at the lower-right without blocking the main conversation. Its header shows `Side conversation` and a close button. |
| 3 | Open the side window before a newly selected parent finishes restoring, then inspect RPC requests. | The app waits for the parent restore, then sends `config/read`, an ephemeral `thread/fork`, and `thread/inject_items`. The fork uses the restored parent model and runtime provider ID, with `ephemeral: true`, `sideConversation: true`, `excludeTurns: true`, and `persistExtendedHistory: false`. |
| 4 | Send a side question and wait for the response. | The user message, live activity, and final response render inside the floating window. The main thread transcript and composer draft remain unchanged. The side window exposes no model or Thinking selector; subsequent turns use the values captured in step 2. |
| 5 | Switch the main chat or navigate to Home while the side conversation remains open. | The side window, its child transcript, and its active turn remain open. Main-chat navigation does not close or replace the side chat. |
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
| 1 | While a side response is running, click the desktop close button or mobile backdrop. | The UI closes immediately. The app rejects pending side requests, interrupts the active side turn after a pending `turn/start` returns its ID, then unsubscribes the child in the background. |
| 2 | Open an idle side conversation and close it. | The UI closes immediately and sends only `thread/unsubscribe`; it does not send an empty `turn/interrupt`. |
| 3 | Let a side turn complete immediately before cleanup reaches the app server, then close it. | Background cleanup still attempts `thread/unsubscribe`; cleanup failures do not reopen the side panel. |
| 4 | Close a side conversation, deliver a late error or approval request for its child, then inspect the main conversation. | The late event does not appear in the main conversation, global error surface, or pending-request UI. A late request receives the side-chat-closed reply. |
| 5 | Refresh the page after closing or while a side conversation is open. | No side window, child transcript, or side draft is restored. |
| 6 | Create another side conversation after closing the previous one. | A new empty ephemeral child opens; the earlier side transcript and draft are absent. |

## Rollback / Cleanup

- Close any side window created during the check.
- Confirm no temporary side child is visible in the thread list after cleanup completes.
- Return the viewport and app theme to their previous settings.
