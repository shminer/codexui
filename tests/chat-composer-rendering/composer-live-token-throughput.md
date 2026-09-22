### Feature: Live and retained output-token throughput above the composer

#### Prerequisites
- Run the app with a Codex app-server that emits `thread/tokenUsage/updated` with `turnId`.
- Prepare a normal prompt, a tool-using prompt, and two threads. Use light and dark themes.

#### Steps
1. Send the normal prompt. Before the first usage event, inspect the line above the input; after each usage event, compare its output-token count with the current turn's cumulative delta.
2. Let the turn run for several seconds without another usage event, then complete it. Compare the final TPS with output tokens divided by the full turn duration.
3. Switch to the other thread and back. Start a new turn in the first thread and check that its live count begins fresh.
4. Run the tool-using prompt and observe the line during a tool wait. Complete a turn with no usage, then reload the page.
5. Repeat in light and dark themes at desktop, `375x812`, and `768x1024` viewports.

#### Expected Results
- The line says `Waiting for token data` before valid usage, then shows `<output tokens> output tokens · <average TPS> TPS`. Token values update only on usage events; TPS recalculates about once a second and includes tool/wait time.
- Completion keeps the final result above the input until the next turn starts. A turn without valid usage shows only `Worked for <duration>`, never `0 TPS` or `Infinity`.
- Switching threads displays that thread's own latest result; reload restores completed results from existing local summaries. The line stays readable without clipping or overlap in both themes and all viewports.

#### Rollback/Cleanup
- No cleanup is needed. Test turns remain in their threads; disposable local summaries can be cleared by removing `codex-web-local.turn-summaries.v1` from browser storage.
