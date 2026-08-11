### User message edit action replaces rollback button

#### Feature/Change Name
The old rollback button is replaced with an `Edit message` action under each eligible user message, while keeping the existing behavior that appends the original text into the composer and rolls the thread back from that turn. The action stays hidden while the thread is generating so it cannot interrupt the active turn.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. An existing thread with at least one completed user/assistant turn
3. A prompt that keeps the assistant response active long enough to inspect the composer

#### Steps
1. Open a thread with multiple completed turns and start a new long response
2. While the response is generating, hover an earlier user message
3. Confirm `Edit message` is hidden and the empty composer shows an enabled stop button
4. Wait for the response to finish, then hover the same user message
5. Confirm `Edit message` appears and assistant responses no longer show the old `Rollback` button
6. Click `Edit message` on the earlier user message with recognizable text
7. Observe the composer draft after the click
8. Confirm the thread rolls back from the selected turn

#### Expected Results
- The action under eligible user messages is labeled `Edit message`
- The action is hidden during an active response, leaving the stop button available for that response
- Assistant responses no longer render the old rollback action
- Clicking `Edit message` appends the original user text into the composer
- The existing rollback behavior still truncates the selected turn and later turns

#### Rollback/Cleanup
- Re-send the edited message if you want to recreate the conversation path

---
