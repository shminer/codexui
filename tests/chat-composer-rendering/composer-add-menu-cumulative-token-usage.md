# Composer add menu shows cumulative thread Token usage

## Feature / Change

The composer add menu shows the cumulative Token usage for the current thread without requesting a second usage source.

## Prerequisites / Setup

- Prepare one existing thread that has received a `thread/tokenUsage/updated` event and another thread with a different cumulative total.
- Keep a new-chat composer available for the no-data case.
- Prepare light and dark themes plus desktop, `375x812`, and `768x1024` viewports.

## Steps

1. Open the existing thread and open the composer `+` menu.
2. Compare the compact `Tokens used` value with the thread's cumulative `total.totalTokens`, then hover the value to inspect the exact count.
3. Complete another turn, reopen the menu, and inspect the updated value.
4. Switch to the second thread and reopen the menu.
5. Open the new-chat composer before any Token usage event exists.
6. Repeat the menu checks in light and dark themes at each prepared viewport.

## Expected Results

- The menu labels the value as `Tokens used` with `Cumulative thread usage` as its description.
- The visible value uses compact formatting while the title exposes the exact count with thousands separators.
- The value updates from the existing Token usage event and switches with the selected thread without an additional request.
- A composer without usage data shows `Awaiting data` instead of `0`.
- The status row remains readable and does not overflow or overlap Goal and attachment controls.

## Rollback / Cleanup

- No persistent setting or test data cleanup is required.
