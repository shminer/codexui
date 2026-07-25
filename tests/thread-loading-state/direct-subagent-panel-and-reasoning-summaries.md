### Feature: Direct subagent panel and reasoning summaries

#### Prerequisites
- App is running from this repository with an authenticated Codex CLI.
- A parent thread can spawn at least one collaboration subagent.

#### Steps
1. Open the parent thread on a 1440x900 desktop viewport.
2. Start or resume a turn that spawns two direct subagents.
3. Reopen a parent thread whose persisted history contains `subAgentActivity` items and verify the right-side Agents panel lists each direct agent once in activity order.
4. Verify the right-side Agents panel appears while the parent turn is running and lists newly started agents without reloading the parent thread.
5. Select an agent and verify its task/status preview and complete read-only thread content load.
6. Confirm the agent detail wraps inside the sidebar without being clipped, including command output, code, changed-file diff, and collapsed Thinking summaries.
7. Drag the sidebar's left separator left and right, then focus it and repeat with Left/Right and Home/End; confirm the sidebar grows and shrinks while the parent conversation uses the remaining width.
8. Use the sidebar's bottom-right control to collapse it completely, confirm the parent conversation reclaims the width, then use the content area's bottom-right control to reopen it and confirm the selected agent detail is unchanged.
9. Refresh the page and switch between parent threads, confirming the last sidebar width and collapsed state persist.
10. Confirm Fork, edit/rollback, implement-plan, and file undo/redo controls remain absent from the selected agent detail.
11. While the selected subagent is thinking, confirm only the streamed reasoning summary is shown; raw reasoning text is not rendered.
12. Switch to another parent thread, wait for the first parent's subagent to finish, then return to the first parent and confirm its status/result preview refreshes without a full thread-list reload.
13. Wait for a subagent to finish while its parent remains selected and confirm its selected detail refreshes without manually reopening the parent thread.
14. Repeat steps 5-9 at 768x1024 and confirm the desktop sidebar remains in layout without horizontal viewport overflow.
15. Resize to 375x812, open the existing Agents button, then resize back to at least 768px; confirm the sheet returns to the in-layout desktop sidebar instead of remaining teleported or disappearing.
16. Return to 375x812, open the Agents button, and repeat steps 5 and 10-13 in the bottom sheet; confirm no desktop separator or bottom sidebar controls appear.
17. Close the mobile sheet by its close button and by tapping the backdrop.
18. Repeat the desktop and mobile checks in light and dark themes.
19. Open a parent thread without direct subagents and confirm neither a desktop panel nor mobile Agents button is shown.

#### Expected Results
- Only direct subagents from the active parent thread are listed.
- Persisted and realtime `subAgentActivity` items populate the panel without extra thread-list requests.
- Subagent details are fetched only after their row is selected.
- Desktop uses a resizable, fully collapsible right-side panel with a default width of 480px; mobile keeps the existing closable bottom sheet.
- The preferred desktop width and collapsed state persist without adding requests or reloads.
- Agent detail content shrinks or scrolls within the sidebar instead of extending beyond its clipped boundary.
- Thread content is read-only and historic reasoning is collapsed by default.
- Realtime thinking displays protocol reasoning summaries only.
- Completing a known direct subagent refreshes its parent state without polling or a full thread-list scan, including after switching away and back.

#### Rollback/Cleanup
- Close the mobile sheet and return to the parent thread list.
- Remove `codex-web-local.subagent-panel-width.v1` and `codex-web-local.subagent-panel-collapsed.v1` from local storage to reset desktop sidebar preferences.
- Revert the feature commit if the subagent panel is not wanted.
