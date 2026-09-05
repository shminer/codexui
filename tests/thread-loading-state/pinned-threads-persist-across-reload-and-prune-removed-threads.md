### Feature: Pinned threads sync across Codex surfaces

#### Prerequisites
- App is running from this repository with the same `CODEX_HOME` as another Codex surface.
- At least two threads exist in the sidebar.
- For list-isolation coverage, use an isolated `CODEX_HOME` with at least three pinned threads, ordinary unpinned sessions under `sessions/`, and one project imported through `Import Project`.

#### Steps
1. Pin two threads from the sidebar using the pin button.
2. Confirm the same threads and order appear in the other Codex surface when its CLI supports native thread sections.
3. Pin or unpin one thread in the other surface, then return focus to codex-mobile.
4. Confirm codex-mobile reflects the external change immediately after focus; leave it visible for 5 seconds and confirm later changes also appear.
5. Refresh the app page and confirm the same threads are still shown in the `Pinned` section and in the same order.
6. Archive one of the pinned threads from the thread menu, then refresh again.
7. Restrict workspace roots so another project's pinned thread is hidden, then pin or unpin a visible thread.
8. In the other Codex surface, pin a different thread immediately before step 7 and confirm both changes survive.
9. Temporarily make the pin write fail, then try to archive a pinned thread.
10. Pin more than 20 older threads and confirm every pinned summary eventually appears.
11. With the isolated home, request `thread/list` through `/codex-api/rpc` using `archived: false`, the native Pinned `sectionId`, `sortKey: 'section_position'`, `sortDirection: 'asc'`, and `limit: 2`; follow `nextCursor` until it is null.
12. Unpin one ordinary session and one imported session after pinning them, wait more than 5 seconds, and refresh the page in both light and dark themes.
13. Confirm the imported project still lists its unpinned chats, then repeat the list request with an empty section, a specific `cwd`, and `archived: true` separately.

#### Expected Results
- CLIs exposing `threadSection/list` and `thread/section/move` use Codex's native `Pinned` section; older CLIs use `~/.codex/.codex-global-state.json` key `pinned-thread-ids`.
- A visible page checks pin state at most once every 5 seconds; a hidden page sends no polling request, and focus/visibility recovery refreshes immediately.
- Pin order is preserved between reloads.
- A failed pin write restores the previous sidebar state instead of showing an unsaved change.
- Archiving explicitly removes that thread from Pinned before sending the archive request.
- A pin write failure leaves the thread unarchived and reports the failure.
- Pinning or unpinning a visible thread does not remove hidden-workspace or concurrently added pins.
- Missing pinned summaries load in consecutive batches of at most 20 requests until all have been attempted.
- Native list pages contain only matching threads, keep the requested order, never exceed the requested limit, and preserve cursor pagination without duplicate or appended ordinary sessions.
- An empty section returns no rows; cwd and archived filters remain intact.
- Unpinned ordinary and imported sessions stay out of Pinned after polling and reload; imported chats remain available in their project.

#### Rollback/Cleanup
- Unpin test threads if needed.
- Remove the isolated home and imported test project after validation; leave the production home and its pins unchanged.
