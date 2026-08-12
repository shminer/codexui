### Native thread Goal management

#### Feature/Change Name
The composer manages the same persisted thread Goal as the official Codex `/goal` command, including editing, pause/resume, clear, usage, and elapsed time.

#### Prerequisites/Setup
1. Codex CLI `0.147.0` or newer with Goals enabled
2. Dev server running at `http://127.0.0.1:4173`
3. One saved thread and access to its Codex TUI session
4. Light and dark themes available

#### Steps
1. On the new-chat home route, open the attachment menu and inspect Goal below Plan mode.
2. Open the saved thread, open Goal, create a non-empty objective, and close/reopen the menu.
3. Start a turn and observe Time used; wait several seconds, then let the turn finish.
4. Pause the Goal, wait, and confirm Time used stays fixed; resume it and start another turn.
5. Edit the objective and verify usage resets according to official Goal replacement semantics; if the Goal already has a Token budget, verify the budget remains visible.
6. Run `/goal` in the matching TUI and verify the same objective, status, time, tokens, and budget; edit or pause it in the TUI and return to Mobile.
7. Refresh Mobile and verify the TUI-side change remains visible; clear the Goal from Mobile and verify `/goal` reports no current Goal.
8. Repeat the saved-thread flow in dark theme and at 375x812 and 768x1024 viewports using a 4,000-character objective.

#### Expected Results
- New chat shows Goal below Plan mode but keeps it disabled until the first message creates a saved thread.
- Mobile and TUI read and mutate one official persisted Goal without local-only state.
- Time advances only while an active Goal has a running turn; idle, paused, blocked, limited, and complete Goals do not accrue display time.
- Edit preserves the official resumable status and Token budget, while editing a complete or budget-limited Goal reactivates it.
- Refresh and reconnect reload the current Goal; clear removes it from both Mobile and TUI.
- Long objective text wraps or scrolls inside the menu without overlap in light/dark and mobile/tablet layouts.

#### Rollback/Cleanup
- Clear the test Goal and archive or delete any thread created only for this check.

---
