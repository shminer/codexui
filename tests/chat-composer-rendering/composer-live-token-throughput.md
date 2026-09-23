### Feature: Live and retained output-token throughput above the composer

#### Prerequisites
- Run the app with a Codex app-server that emits `thread/tokenUsage/updated` with `turnId`.
- Prepare a normal prompt, a tool-using prompt, and two threads. Use light and dark themes.

#### Steps
1. Send the normal prompt. Before the first usage event, inspect the line above the input; after each usage event, compare its output-token count with the current turn's cumulative delta.
2. Let the turn stream at least two assistant text deltas, then complete it. Compare prefill TPS with input tokens divided by time to first text, decode TPS with non-reasoning output tokens divided by text-streaming time, and average TPS with output tokens divided by the full turn duration.
3. Switch to the other thread and back. Start a new turn in the first thread and check that its live count begins fresh.
4. Run the tool-using prompt and observe the line during a tool wait. Complete a turn with no usage, then reload the page.
5. Repeat in light and dark themes at desktop, `375x812`, and `768x1024` viewports.

#### Expected Results
- The existing line above the composer says `Waiting for token data` before valid usage, then shows `<output tokens> output tokens · <prefill TPS> prefill TPS · <decode TPS> decode TPS · <average TPS> avg TPS` when all measurements are available. No additional UI row or panel is introduced.
- Prefill TPS is client-observed input tokens divided by time from turn start to first assistant text delta, so it includes queue, network, and pre-text reasoning. Decode TPS excludes reasoning output tokens and each text segment's first token, then sums only first-to-last delta time within each assistant text segment. Average TPS retains the full-turn calculation, including tools and waits.
- Completion keeps the final result above the input until the next turn starts. A turn without valid usage shows only `Worked for <duration>`, never `0 TPS` or `Infinity`.
- Switching threads displays that thread's own latest result; reload restores completed results from existing local summaries. The line stays readable without clipping or overlap in both themes and all viewports.

#### Rollback/Cleanup
- No cleanup is needed. Test turns remain in their threads; disposable local summaries can be cleared by removing `codex-web-local.turn-summaries.v1` from browser storage.
