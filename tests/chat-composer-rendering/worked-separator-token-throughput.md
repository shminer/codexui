### Feature: Worked separator shows per-turn token throughput

#### Prerequisites
- Run the app server from this repository with a Codex version that emits `thread/tokenUsage/updated` notifications containing `turnId`.
- Prepare one normal prompt and one prompt that causes at least one tool or command call before the final response.
- Make light and dark themes available at desktop, `375x812`, and `768x1024` viewports.

#### Steps
1. Open a thread, send the normal prompt, and wait for the turn to complete.
2. Locate the `Worked for ...` separator immediately before the final assistant response.
3. Confirm the separator shows elapsed time, output tokens, and a one-decimal TPS value.
4. Send the tool-using prompt and compare the next separator with the completed turn's token usage and elapsed duration.
5. Switch to another thread, complete a turn there, and confirm its result does not reuse the first thread's values.
6. Complete or interrupt a turn that produces no token usage update and confirm the separator still renders normally without token or TPS text.
7. Repeat the separator checks in light and dark themes at desktop, `375x812`, and `768x1024` viewports.

#### Expected Results
- A completed turn with valid usage displays `Worked for <duration> · <output tokens> output tokens · <TPS> TPS`.
- Output tokens use thousands separators and TPS uses exactly one decimal place.
- TPS equals the turn's output-token delta divided by its full elapsed time, including reasoning, tool work, and waits.
- Repeated usage notifications do not double-count tokens, and thread or turn changes do not leak prior values.
- Missing, zero, or regressed usage and zero-duration turns retain the original `Worked for <duration>` text.
- The longer separator remains readable without clipping, overlap, or horizontal overflow in both themes and all tested viewports.

#### Rollback/Cleanup
- No persistent setting or test data cleanup is required.
