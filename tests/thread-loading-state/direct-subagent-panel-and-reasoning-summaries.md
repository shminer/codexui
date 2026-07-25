### Feature: Direct subagent panel and reasoning summaries

#### Prerequisites
- App is running from this repository with an authenticated Codex CLI.
- A parent thread can spawn at least one collaboration subagent.

#### Steps
1. Open the parent thread on a desktop viewport at least 768px wide.
2. Start or resume a turn that spawns two direct subagents.
3. Verify the right-side Agents panel appears while the parent turn is running and lists each agent once in spawn order.
4. Select an agent and verify its task/status preview and complete read-only thread content load.
5. Confirm command output, code, changed-file diff, and collapsed Thinking summary are readable, while Fork, edit/rollback, implement-plan, and file undo/redo controls are absent.
6. While the selected subagent is thinking, confirm only the streamed reasoning summary is shown; raw reasoning text is not rendered.
7. Switch to another parent thread, wait for the first parent's subagent to finish, then return to the first parent and confirm its status/result preview refreshes without a full thread-list reload.
8. Wait for a subagent to finish while its parent remains selected and confirm its selected detail refreshes without manually reopening the parent thread.
9. Resize below 768px, open the floating Agents button, and repeat steps 4-8 in the bottom sheet.
10. Close the sheet by its close button and by tapping the backdrop.
11. Open a parent thread without direct subagents and confirm neither a desktop panel nor mobile Agents button is shown.

#### Expected Results
- Only direct subagents from the active parent thread are listed.
- Subagent details are fetched only after their row is selected.
- Desktop uses a right-side panel; mobile uses a closable bottom sheet.
- Thread content is read-only and historic reasoning is collapsed by default.
- Realtime thinking displays protocol reasoning summaries only.
- Completing a known direct subagent refreshes its parent state without polling or a full thread-list scan, including after switching away and back.

#### Rollback/Cleanup
- Close the mobile sheet and return to the parent thread list.
- Revert the feature commit if the subagent panel is not wanted.
