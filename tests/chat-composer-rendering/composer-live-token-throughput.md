### Feature: Live and retained output-token throughput above the composer

#### Prerequisites
- Run the app with a Codex app-server that emits `thread/tokenUsage/updated` with `turnId`.
- Prepare a normal prompt, a tool-using prompt, and two threads. Use light and dark themes.

#### Steps
1. Send the normal prompt. Before the first usage event, inspect the line above the input; after each usage event, compare its output-token count with the current turn's cumulative delta.
2. Let the turn stream at least two assistant text deltas, then complete it. Compare PF tps with input tokens divided by time to first text, dec tps with non-reasoning output tokens divided by text-streaming time, and avg TPS with output tokens divided by the full turn duration.
3. Switch to the other thread and back. Start a new turn in the first thread and check that its live count begins fresh.
4. Run the tool-using prompt and observe the line during a tool wait. Complete a turn with no usage, then reload the page.
5. Repeat in light and dark themes at desktop, `375x812`, and `768x1024` viewports.
6. While a turn runs, queue one message and then several messages. Inspect the TPS line, queue and input together; edit, steer, delete and reorder queued messages. Expand the terminal and trigger an approval request. Repeat the queue checks in a side conversation and its popped-out window.
7. In an existing main thread, click the side-conversation icon next to Send/Stop. Minimize and reopen the side chat. Confirm that its own input has no nested side-chat icon. Open the main input's add menu and inspect Goal; type a draft, switch threads and return, then reload.

#### Expected Results
- The existing line above the composer says `Waiting for token data` before valid usage, then shows `<output tokens> otks · <prefill rate> PF tps · <decode rate> dec tps · <average rate> avg TPS` when all measurements are available. No additional UI row or panel is introduced.
- Token and rate values share compact units: values below 1,000 are integers, thousands use `k`, and millions use `M`.
- PF tps is client-observed input tokens divided by time from turn start to first assistant text delta, so it includes queue, network, and pre-text reasoning. Dec tps excludes reasoning output tokens and each text segment's first token, then sums only first-to-last delta time within each assistant text segment. Avg TPS retains the full-turn calculation, including tools and waits.
- Completion keeps the final result above the input until the next turn starts. A turn without valid usage shows only `Worked for <duration>`, never `0 TPS` or `Infinity`.
- Switching threads displays that thread's own latest result; reload restores completed results from existing local summaries. The line stays readable without clipping or overlap in both themes and all viewports.
- With queued messages, the order is TPS, queue, input. TPS stays outside the continuous queue/input border and wraps on narrow screens. Queue and input have matching left/right edges, no gap and no rounded input corners at their shared boundary. Without a queue, the input has its full rounded outline. The terminal sits above the input area; approvals retain a queue directly attached to the request panel. Queue actions never submit the input form.
- Main composers enable the side-conversation icon, Goal and draft persistence by default. Side composers explicitly disable these capabilities; their drafts remain in memory only. Main drafts survive thread switching and reload.

#### Rollback/Cleanup
- No cleanup is needed. Test turns remain in their threads; disposable local summaries can be cleared by removing `codex-web-local.turn-summaries.v1` from browser storage.
- Remove disposable queued messages, close the test terminal and end any temporary side conversation after the layout check.
