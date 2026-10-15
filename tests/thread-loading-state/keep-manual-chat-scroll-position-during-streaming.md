### Feature: Keep manual chat scroll position during streaming

#### Prerequisites
- App is running from this repository.
- A thread exists with enough history to allow scrolling away from bottom.

#### Steps
1. Open the thread and scroll upward so latest messages are not visible.
2. Send a new message that produces a streaming assistant response.
3. During streaming, do not scroll and observe viewport position.
4. After streaming completes, verify the viewport remains at the same manual position.
5. Page back far enough to enter a retained history window, then trigger a same-thread wake/reconnect or background refresh. Verify the reading anchor and visible window remain unchanged, and no implicit latest-page request occurs.
6. Click Jump to latest with a delayed response, then a failed response. Verify history, search target and anchor are preserved until success; retry and confirm following resumes only after latest loading succeeds.
7. Move to the final newer page when its last turn exceeds the text budget. Verify any omitted newer content still exposes a later/latest path instead of incorrectly enabling bottom following.
8. Repeat in a read-only Agent detail and archived conversation. Verify there are no edit, fork, rollback or send controls, and older/latest paging remains available.

#### Expected Results
- Streaming updates do not force auto-scroll to the bottom when user has manually scrolled away.
- User can continue reading older history while the response streams.
- If the thread is already at the bottom when streaming starts, the latest streaming overlay remains visible.
- History/newer flags stop bottom locking immediately. Clearing those flags in a same-thread background update does not independently turn following back on.
- Scrolling inside the loaded virtual list does not request history or evict body content. Ordinary return to latest preserves expanded history when no new content exists; an unread server boundary requests latest, and explicit Release history performs a successful read before eviction.

#### Verification Boundary
- New history-window and latest-failure checks have unit/wiring coverage; live browser anchor verification remains pending.
- Static performance review: the history marker is a read-only prop derived from existing state. The component adds no persisted state, polling or subscription and calls the shared latest loader only on explicit thread opening or Jump to latest.

#### Rollback/Cleanup
- Revert the scroll-preservation change in `src/components/content/ThreadConversation.vue` if manual scroll locking needs to be removed.
