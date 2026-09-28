### User message edit copies text without changing the thread

#### Feature/Change Name
`Edit message` appends the selected user message to the composer. It does not revert conversation history or workspace files, and it remains available while a response is generating.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. An existing thread with multiple completed user/assistant turns
3. Browser developer tools open on the Network panel

#### Steps
1. Type recognizable text into the composer without sending it
2. Hover an earlier non-empty user message and click `Edit message`
3. Confirm the original draft remains and the selected message is appended on a new line
4. Confirm the composer receives focus and no message is sent automatically
5. Confirm the conversation history, selected thread, and workspace files are unchanged
6. Start a long response and repeat the action while the response is generating
7. Confirm the response continues and the selected message is appended to the composer
8. Inspect Network traffic for both clicks

#### Expected Results
- The action under eligible user messages is labeled `Edit message`
- The action remains available during an active response
- Assistant responses no longer render the old rollback action
- Clicking `Edit message` appends the original user text without replacing an existing draft
- Clicking does not interrupt the active turn, truncate messages, refresh history, or undo file changes
- No `thread/revert`, rollback-file, message-send, or extra thread-read request is made

#### Rollback/Cleanup
- Clear the composer draft created by the test.

#### Performance Audit

- Each click emits one local component event and performs one existing draft string append.
- The action performs no RPC or HTTP request, cache invalidation, message-list scan, retry, or background refresh.
- Runtime timing is not required for this constant local path; verify the zero-request claim in the Network panel.
