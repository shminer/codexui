### Feature: Direct subagent panel and reasoning summaries

#### Prerequisites
- App is running from this repository with an authenticated Codex CLI.
- A parent thread can spawn at least one collaboration subagent.

#### Steps
1. Open the parent thread on a 1440x900 desktop viewport.
2. Start or resume a turn that spawns two direct subagents.
3. Reopen a parent thread whose persisted history contains `subAgentActivity` items and verify the right-side Agents panel lists each direct agent once in activity order.
4. Verify the right-side Agents panel appears while the parent turn is running and lists newly started agents without reloading the parent thread.
5. Wait for one agent to reach a terminal status and confirm it moves to History while running or initializing agents remain in Running.
6. Select an agent and verify its task/status preview and read-only recent thread content load; load earlier messages on demand.
7. Confirm the agent detail wraps inside the sidebar without being clipped, including command output, code, changed-file diff, and collapsed Thinking summaries.
8. Drag the sidebar's left separator left and right, then focus it and repeat with Left/Right and Home/End; confirm the sidebar grows and shrinks while the parent conversation uses the remaining width.
9. Use the right column's top-right Agents control to collapse the sidebar to a 44px icon rail, confirm the parent header, messages, terminal, queue and composer reclaim the same width, then reopen it and confirm the selected agent detail is unchanged.
10. Refresh the page and switch between parent threads, confirming the last sidebar width and collapsed state persist.
11. Confirm Fork, edit/rollback, implement-plan, and file undo/redo controls remain absent from the selected agent detail.
12. While the selected subagent is thinking, confirm only the streamed reasoning summary is shown; raw reasoning text is not rendered.
13. Switch to another parent thread, wait for the first parent's subagent to finish, then return to the first parent and confirm the terminal agent appears in History without a full thread-list reload.
14. Wait for a selected subagent to finish while its parent remains selected and confirm its detail stays open and refreshes once for the terminal result.
15. Repeat steps 6-10 at 768x1024, including a saved left sidebar width of 620px. Confirm the left sidebar temporarily shrinks, the right sidebar uses a 44px rail when workspace width is below 612px, and the main column retains at least 332px without horizontal viewport overflow. Widen the viewport and confirm the saved left/right widths return without rewriting storage. Start dragging the left sidebar from its actual displayed width and confirm there is no dead zone.
16. Resize to 375x812, open the Agents button at the content header's top-right, then resize back to at least 768px; confirm the sheet returns to the in-layout desktop sidebar instead of remaining teleported or disappearing.
17. Return to 375x812, open the top-right Agents button, and repeat steps 6 and 11-14 in the bottom sheet; confirm no desktop separator or desktop collapse control appears.
18. Close the mobile sheet by its close button and by tapping the backdrop.
19. Repeat the desktop and mobile checks in light and dark themes.
20. Open a parent thread with only terminal subagents and confirm the Agents entry remains available and History retains the completed tasks.
21. Open a parent whose agents occur only outside the recent history window. Use Load history and Load older collaboration; verify partial/loaded states, no duplicated agents or event IDs, and no automatic full-history scan.
22. Inspect Collaboration for spawn, sendMessage/sendInput, wait and close events, including agent-to-agent sender/receiver IDs and state messages. Confirm the parent itself is not listed as a child and no send/control actions appear.
23. Delay an agent history/detail response, switch parent threads or detail rows, then release it. Confirm no old result or stuck loading indicator appears in the new view; empty history remains viewable on mobile.
24. Select a running agent and stream assistant text interleaved with commands, plans and file changes. Confirm the response body updates before completion and replaces a stale same-ID snapshot without duplicating rows. Copy a response and verify it contains the streamed text.
25. Browse older agent pages while it continues running. Confirm latest live rows are not inserted into the older window; return to latest to see the current response. Finish the agent and confirm one terminal refresh connects to the final history without duplicate response rows.
26. Select a running agent whose latest raw turn has no displayable historical messages. Load earlier history, then load later history or jump to latest. Confirm both realtime body and the Thinking/activity overlay are absent from the older window and return only at the latest boundary.
27. While either sidebar is expanded/collapsed, expand the main composer. Confirm it fills only the main column on desktop and leaves both sidebar controls usable; repeat in light/dark themes and verify the mobile composer still uses the viewport.
28. Open an empty parent and use the desktop icon rail to load collaboration history. Confirm the control remains available without current agents, a narrow workspace disables expansion without changing the saved preference, and widening restores the preferred expanded view.
29. Deliver an activity path, then a newer nonempty result summary with no communications, then an unknown activity or empty state message. Confirm the summary remains the row preview, terminal status is not cleared by unknown activity, and communications remain deduplicated. Load an older page and confirm it does not overwrite the newer summary.
30. Open a running child thread in the main conversation, return to its parent, and open the same child in the Agent sidebar. Stream same-ID reply, command and plan updates. Confirm the sidebar updates without duplicate rows even when restored rows exist in the main state cache. Delay the independent detail snapshot so it contains a longer reply or a newer command output cursor than the cache; confirm it is not shortened, and later current-turn deltas continue updating it. Browse an older Agent page and confirm these current-turn rows remain absent until returning to latest. Repeat on desktop and mobile.

#### Expected Results
- Collaboration participants from the active parent thread are listed, including known agent-to-agent communications.
- Running lists `running` and `pendingInit`; History retains terminal and unknown statuses. Completed tasks and selected details remain accessible.
- Persisted and realtime `subAgentActivity` items populate the panel without extra thread-list requests.
- Subagent details are fetched only after their row is selected, with one refresh on transition to a terminal status. Older messages and collaboration pages load on demand.
- Desktop uses a full-height resizable right column with a default width of 480px and a 44px collapsed icon rail; its toggle and the mobile sheet entry stay at the top-right, opposite the left sidebar control. The main header, message area, terminal, queue and composer share the same remaining width.
- The preferred desktop width and collapsed state persist without adding requests or reloads.
- Agent detail content shrinks or scrolls within the sidebar instead of extending beyond its clipped boundary.
- Thread content is read-only and historic reasoning is collapsed by default.
- Realtime thinking displays protocol reasoning summaries only.
- Running details reuse the existing notification-fed live messages; no extra polling, history request or notification subscription is added. Merging is linear in the selected window plus its existing live rows. The agent detail remains read-only.
- Current-turn restored rows are included in the same bounded realtime view as live rows. Same-ID reply prefixes preserve the more complete body, command output uses total length or offset-plus-length cursors, and terminal command status does not regress. Historical windows and idle detail merging keep their existing isolation.
- Activity paths only fill empty previews. Nonempty result summaries replace older summaries even when the incoming snapshot has no communications; later activity or empty messages preserve the selected summary and its source.
- Completing a known direct subagent refreshes its parent state without polling or a full thread-list scan, including after switching away and back.

#### Rollback/Cleanup
- Close the mobile sheet and return to the parent thread list.
- Remove `codex-web-local.subagent-panel-width.v1` and `codex-web-local.subagent-panel-collapsed.v1` from local storage to reset desktop sidebar preferences.
- Revert the feature commit if the subagent panel is not wanted.

#### Verification Boundary
- The new summary-source, full-height column, 44px rail, narrow-workspace and history-reading regressions are covered by additional unit/wiring cases. Browser acceptance of these changes is pending; the following browser evidence describes the earlier side-conversation changes, not the new layout.
- Static performance review: one ResizeObserver watches the common workspace, disconnects on mobile/unmount and rebinds after Teleport mode changes. Collapsing retains the selected detail without another request. Narrow-space fallback changes only rendered width, not preferences, and uses no additional resize listener, polling or history scan.
- `pnpm exec vitest run src/composables/useThreadHistoryWindow.test.ts src/components/content/threadSubagentPanel.wiring.test.ts` passes the focused history/wiring cases, including navigation away from an empty latest turn.
- `node output/playwright/side-agent-acceptance.cjs` passes six combinations at `http://127.0.0.1:4173/#/thread/review-testchat`: 1440x1000, 768x1024 and 375x812 in light/dark themes. Mock HTTP/RPC/WebSocket events drive the real selected-Agent UI; no component props are changed to simulate the result.
- Verified live body alongside commands, no latest body/activity overlay in older history, latest restoration, one final response row, no horizontal viewport overflow and no browser page errors. Screenshots and request records are in `output/playwright/side-agent-acceptance.json`.
- Screenshot inspection found white Agent surfaces in dark mode. Theme overrides now live in `src/style.css`; reruns check both the inner surface and visible parent-panel background and produce readable desktop/mobile dark screenshots.
- The combined 238-case related mock run has 230 passes and 8 pre-existing failures reproduced on `cee6441`: two Agent-list cases and six provider-model cases. These are not classified as new regressions; report: `output/playwright/side-mock-regression.json`, baseline: `output/playwright/desktop-mock-baseline.json`.
- Performance: runtime content reuses the existing WebSocket stream; older/latest navigation is on demand, with no additional polling or subscription. Boundary detection adds one set lookup to the existing bounded-window pass. Global theme overrides add no runtime request or JavaScript work.
- Frontend/server no-emit type checks and `git diff --check` pass. No build or publication was performed. Real-model integration and long-duration browser measurements remain untested; browser contexts close after verification, and 4173 remains running.
