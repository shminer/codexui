# Fork from selected response

## Feature / Change

The Fork action beside an assistant response creates a new thread ending at that response. The thread-list fork action still copies the complete thread.

## Prerequisites

- Use a completed thread with at least three user turns and assistant responses.
- Include a thread with more than ten turns so the newest page and an older loaded page can both be checked.
- Use a Codex CLI supporting the inclusive `thread/fork.lastTurnId` parameter.

## Actions And Expected Results

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Click Fork beside an earlier assistant response. | The new thread contains that response and all earlier turns, but none of the later turns. Its selected model and Thinking setting match the source thread. |
| 2 | Refresh the forked thread. | The same response remains the final turn; later source turns do not reappear. |
| 3 | Load earlier messages in a thread with more than ten turns, then fork from a response on that older page. | The selected response is still the final turn, regardless of the page's displayed turn indices. |
| 4 | Click Fork beside the final response. | The new thread contains the full source history. |
| 5 | Use Create chat fork from the thread-list menu. | This separate action copies the complete thread. |
| 6 | Inspect RPC traffic for response Fork. | Exactly one `thread/fork` includes the selected stable `lastTurnId`. There are no history-page requests or `thread/rollback` calls. |
| 7 | Simulate a server returning a full fork despite `lastTurnId`, or failing result verification. | The source remains selected, the invalid fork is archived, and a visible error explains the failure. If archive fails, the error identifies the incomplete fork. |

## Rollback / Cleanup

- Delete the test forks after confirming their content.
- Keep the original source thread unchanged.

### Long fork pagination

- Setup: a completed source thread with more than 20 turns.
- Fork from a response after turn 15. Open the resulting fork immediately and click Load earlier messages.
- Expected: the fork ends at exactly the selected response, the initial recent page exposes the earlier-history control without a reload, and older pages retain turn indices and provider metadata.
- Cleanup: archive the test fork. Pagination metadata is copied from the existing verification read, with no extra network request.

### Fork larger than the inactive cache budget

- Setup: a completed source thread with a response whose estimated text is greater than 512 KiB and less than 2 MiB. For a mock, use separate source and fork responses keyed by their thread IDs; the source may not have loaded its body yet.
- Fork from that response and inspect the resulting thread immediately. Confirm its final turn ID matches the selected source response, the new fork is selected, and the full response remains visible without an error.
- Inspect the mock requests: one source detail read, one fork detail verification read, and one fork request carrying the selected `lastTurnId`. The source read must not consume the fork's large-body fixture.
- Cleanup: archive the test fork and preserve the original source thread. Reset the scoped mocks after the case.
