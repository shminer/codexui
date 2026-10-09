### Feature: Lazy message rendering (windowed conversation)

#### Prerequisites
- App is running from this repository.
- A thread exists with more than 50 messages (send many short messages, or use a long-running session).

#### Steps — initial load window

1. Open a thread with 60+ messages.
2. Observe that the conversation list does **not** show all messages immediately — only the most recent ~50 are rendered.
3. Verify the latest messages are visible and the chat is scrolled to the bottom.
4. Confirm a "Load earlier messages" button appears at the top of the visible list.

#### Steps — scroll-triggered load

5. Scroll up slowly toward the top of the conversation list.
6. When the scroll position reaches within ~200 px of the top, verify that the previous 30 messages appear automatically above the current ones.
7. Confirm the viewport does **not** jump — the messages you were reading stay in view.
8. Repeat scrolling up to verify additional chunks load on demand.
9. Once the oldest persisted messages are reached, verify the "Load earlier messages" button disappears. The newest end may be unloaded while reading older history.

#### Steps — manual load button

10. Reload the page and open the same long thread.
11. Click "Load earlier messages" button without scrolling.
12. Verify 30 older messages are prepended and scroll position is preserved.
13. While older messages are visible, allow the active thread to receive several new messages.
14. Confirm the current reading position stays anchored and the older-message window remains bounded to 100 rendered rows.
15. Click `Jump to latest` and confirm the conversation returns to the newest bounded window and resumes following output.
16. Force a message-list shrink or rollback and confirm at least one message remains visible whenever the list is non-empty.

#### Steps — live session growth

17. Start an active Codex session (or send many messages in quick succession).
18. Let the conversation exceed 50 messages while staying scrolled to the bottom.
19. Verify the rendered count stays bounded (top of the DOM list advances as new messages arrive).
20. Scroll up and confirm "Load earlier messages" works to reveal trimmed messages.

#### Steps — rollback / message shrink

21. In a thread with a turn that can be rolled back, trigger a rollback.
22. Verify the conversation does **not** go blank — messages still render after the list shrinks.
23. Confirm `renderWindowStart` recovers gracefully and earlier messages remain accessible.

#### Expected Results
- Only ≤50 messages are in the DOM on initial load.
- Scrolling to the top (or clicking the button) reveals older messages without a viewport jump; distant rows are removed from the opposite end.
- During live output, the rendered window stays bounded; old messages are trimmed from the top while the user follows the bottom.
- After a rollback the conversation remains visible; a non-empty conversation never renders only the load control.

#### Rollback/Cleanup
- No persistent state is changed — closing or refreshing the tab resets the render window.

### Feature: Long-lived conversation and command output retention

#### Prerequisites/Setup
- Use a persisted thread with at least 100 turns, including a turn with more than 30 commands and an output larger than 65,536 UTF-16 code units.
- Keep a temporary side conversation available to check that its only transcript is protected.
- Perform these checks manually in light and dark themes, including 375x812 and 768x1024 viewports. These are acceptance instructions, not recorded execution results.

#### Steps
1. Keep following a persisted thread while adding new turns. Inspect message rows and command output previews with browser developer tools.
2. Pause following and repeatedly load earlier messages. Then load newer messages to return through the same history.
3. While reading older content, produce new turns in that thread. Confirm the reading anchor does not move to the latest output.
4. Collapse a command group and an individual command. Inspect the DOM, then reopen them and switch command pages.
5. Open an oversized completed command. Page through earlier and later output; copy its complete output and compare with the source record.
6. Switch to another thread while an output page request is pending. Confirm the old response does not replace the new thread's content.
7. Simulate a failed historical request, retry it, and use Jump to latest. Confirm failed requests preserve the current reading window.
8. Visit more than three other persisted threads. Reopen the first thread and confirm its history is restored on demand.
9. Open and close a temporary side conversation; confirm ordinary cache eviction does not silently clear its transcript while it remains open.
10. Include a supplementary Unicode character across an output page boundary in both persisted and temporary conversations. Confirm adjacent pages reconstruct the original text without split characters.
11. In browser developer tools, compare retained heap after repeated thread/history navigation and garbage collection. Check that old output buffers and evicted message windows are released. Record measurements separately; this change has only been checked statically.

#### Expected Results
- Latest rendering stays at 50 message rows; history rendering stays at at most 100 rows, excluding independent approval/live overlays.
- Collapsed command contents have no output DOM. An expanded group renders at most 30 commands per page.
- Ordinary command state retains a tail preview of at most 65,536 UTF-16 code units, with explicit truncated metadata. Completed history can be read page by page; copying uses the complete source rather than the preview.
- Tail previews are materialized separately from the original output buffer. Ordinary live output is copied/truncated per 50 ms batch, with an immediate flush when the temporary combined preview reaches 131,072 code units.
- Older loaded history is replaced as the window moves, rather than accumulated. Source history and real running commands remain intact.
- Streaming code is shown without repeated syntax highlighting; completed large code blocks avoid synchronous highlighting and oversized cache entries.
- Protected temporary/unpersisted content, a single oversized turn, explicit full-copy allocations, and upstream full-item reads are documented exceptions to strict memory bounds.

#### Rollback/Cleanup
- Close output details and history panels; temporary page caches are released. No saved conversation is deleted or migrated.
- Remove only test conversations/commands intentionally created for this check. Keep existing persistent service processes running.
