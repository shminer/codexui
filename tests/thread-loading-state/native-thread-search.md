### Native cross-thread and in-thread search

#### Prerequisites/Setup
- Existing local server, CLI with experimental search protocols, and threads containing a unique marker in old user/final assistant messages.
- Include a matching thread not yet loaded in the sidebar and an archived thread. Prepare an explicitly unsupported runtime and a failed-network case separately.

#### Steps
1. Search the marker in the sidebar; confirm a flat result list without project paths, snippets or match positions. Open an initially unloaded hit.
2. Search an ordered-character abbreviation of a title; confirm exact results precede fuzzy results. Load more and rapidly change the query.
3. Switch Active/Archived; confirm scope isolation and no late response from the previous scope.
4. In the main conversation, open the left three-dot menu and select Find in thread (会话内搜索) for old Chinese and emoji-containing messages. Navigate forward/backward across match pages and confirm message outline and snippet mark.
5. Confirm an unloaded match loads only its turn and that normal history, fork, streaming and latest-message navigation still work after closing search.
6. Change thread/query while a target request is pending. Verify no stale result or target is applied.
7. Verify unsupported full-text shows Title search only; unsupported in-thread search has an explicit status. Network/auth/timeouts show errors, not silent empty results or downgrade. Retry after recovery.
8. Repeat in light/dark themes at desktop, 375x812 and 768x1024.

#### Expected Results
- Native full-text and occurrence pagination work across history; title metadata loading reuses one serial task and shows progress.
- Match counts distinguish loaded pages with `+`; UTF-16 snippets render safely, target rendering stays bounded, IDs remain real turn/item IDs.
- The removed legacy thread-search endpoint/body index is unused; search does not fetch every thread body.

#### Rollback/Cleanup
- Remove disposable marker threads and restore their original archive state.
