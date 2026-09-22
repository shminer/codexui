### Feature: Rapid thread switching during active load

#### Prerequisites
- Start app from this repository (`pnpm run dev`).
- Ensure there are at least 3 existing threads with enough history so opening each thread triggers a visible loading state.

#### Steps
1. Open thread A from the sidebar.
2. While thread A is still loading, quickly click thread B and then thread C.
3. Repeat fast switching across multiple threads (for example A -> B -> C -> A) before each load settles.
4. Observe selected row highlight, URL route (`/thread/:threadId`), and conversation content after loading settles.
5. While C is loading, let A finish (or fail) first; return to A after C finishes. Send a message while a thread's background restore is still pending.

#### Expected Results
- The final clicked thread is always the selected thread.
- The selected row and conversation switch to each clicked thread immediately, without waiting for a previous thread's restore; the loading indicator belongs only to the current thread.
- Sidebar highlight, route thread id, and rendered conversation stay in sync.
- No stale intermediate selection remains after rapid clicks.
- A's late response or error does not replace C's content or show an error on C. Returning to A uses its loaded messages; sending waits for the same thread's restore without starting a second restore.

#### Rollback/Cleanup
- No cleanup required.
