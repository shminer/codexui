### Feature: Assistant timestamp shows per-turn token throughput

#### Prerequisites
- Run the app server from this repository with a Codex version that emits `thread/tokenUsage/updated` notifications containing `turnId`.
- Prepare one normal prompt and one prompt that causes at least one tool or command call before the final response.
- Keep the browser event log available so cumulative output-token values and notification turn IDs can be compared with the separator.
- Make light and dark themes available at desktop, `375x812`, and `768x1024` viewports.

#### Steps
1. Open a thread, send the normal prompt, and wait for the turn to complete.
2. Locate the `Worked for ...` separator immediately before the final assistant response.
3. Confirm the separator shows elapsed time only, and the final assistant response timestamp is followed by ` - <output tokens> output tokens · <TPS> TPS`.
4. Send the tool-using prompt and compare the next separator with the completed turn's token usage and elapsed duration.
5. Switch to another thread, complete a turn there, and confirm its result does not reuse the first thread's values.
6. Complete or interrupt a turn that produces no token usage update and confirm the separator still renders normally without token or TPS text.
7. Reload while a longer turn is running, observe at least two usage notifications after reconnecting, and complete the turn.
8. Queue a second prompt, let it start immediately after the first turn completes, and confirm a late usage notification for the first turn is not charged to the second.
9. Replay a same-turn usage sequence whose cumulative output count decreases while remaining above its initial baseline.
10. Repeat the timestamp and separator checks in light and dark themes at desktop, `375x812`, and `768x1024` viewports.
11. Complete another turn, reload the same browser tab, and inspect both completed turns.

#### Expected Results
- A completed turn with valid usage displays `Worked for <duration>` before the response and `<timestamp> - <output tokens> output tokens · <TPS> TPS` after the final assistant response.
- Output tokens below 1,000 show the full number; larger counts use compact units such as `1.2K` and `1M`. TPS uses exactly one decimal place.
- TPS equals the turn's output-token delta divided by its full elapsed time, including reasoning, tool work, and waits.
- Repeated usage notifications do not double-count tokens, and thread or turn changes do not leak prior values.
- A recovered active turn counts only output observed after its first post-reconnect usage notification.
- A late notification from the directly preceding turn can advance the next turn's baseline but cannot add tokens to that turn.
- Any same-turn cumulative counter regression removes output-token and TPS text for that turn.
- Missing, zero, or regressed usage and zero-duration turns retain `Worked for <duration>` and show no token or TPS text after the timestamp.
- The timestamp and statistics remain readable without clipping, overlap, or horizontal overflow in both themes and all tested viewports.
- After reload, each completed turn retains its own `Worked for` duration and valid token/TPS statistics beside its final response timestamp; newly completed turns do not erase earlier records. Records are local to this browser and limited to the latest 100 completed turns per thread.

#### Rollback/Cleanup
- In a disposable test browser, remove `codex-web-local.turn-summaries.v1` from local storage to clear test records. Keep existing browser data untouched otherwise.
