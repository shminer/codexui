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
| 3 | Inspect RPC requests made while opening. | The app sends `config/read`, an ephemeral `thread/fork` for the current parent thread, and `thread/inject_items`. The fork includes `excludeTurns: true`; the injected item is the hidden side boundary. |
| 4 | Send a side question and wait for the response. | The user message, live activity, and final response render inside the floating window. The main thread transcript and composer draft remain unchanged. Only one `turn/start` is sent for the side question. |
| 5 | Start a normal main-thread turn, then open the side conversation while that turn is still running. | The side window opens and can exchange messages while the main turn continues independently. |
| 6 | Switch between light and dark themes. | The panel, header, input, buttons, error surface, and message area remain readable with no light surface left on the dark page. |

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
| 2 | Open another side conversation, wait for an idle response, and close it. | The app sends `thread/unsubscribe` without interrupting a completed turn. |
| 3 | Inspect the thread list, then reload the page. | No side-conversation thread appears in the thread list before or after reload, and no side messages return. |
| 4 | Open a side conversation and navigate to another main thread or Home. | The side conversation closes and is discarded instead of following the new route. |
| 5 | Reopen a side conversation on the original parent. | A new empty side window opens; the prior side transcript and draft are absent. |

## Rollback / Cleanup

- Close the side conversation with its header close button.
- Confirm no temporary side thread remains in the thread list.
- Return the viewport and app theme to their previous settings.
