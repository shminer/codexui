# Sidebar toolbar new thread and file browser actions

## Feature/Change Name
The expanded sidebar keeps the active project when starting a thread and exposes the current folder browser immediately to the right of that action.

## Prerequisites/Setup
1. Start local Vite: `pnpm run dev --host 127.0.0.1 --port 4173`.
2. Use a workspace with at least one project-backed thread.

## Steps
1. In light theme, open `http://127.0.0.1:4173/#/`.
2. Select a thread inside a project from the sidebar.
3. Confirm a folder button appears immediately to the right of the toolbar Start new thread button.
4. Click the folder button and confirm a new tab opens `/codex-local-browse...` for the active thread's folder without changing the current chat.
5. Click the toolbar Start new thread button.
6. Confirm the home/new-thread composer opens with the same project folder selected, not an empty or projectless selection.
7. Send a first message and confirm the new thread appears under the same project in the sidebar.
8. While already on the home/new-thread route with a folder selected, click Start new thread again and confirm the selected folder is not cleared.
9. At 375x812, open the sidebar drawer and confirm the same two toolbar actions remain ordered and usable.
10. Repeat the file browser and Start new thread flows in dark theme.

## Expected Results
- The toolbar Start new thread action preserves the active thread's project context.
- The file browser action is shown only in the expanded sidebar, follows Start new thread, and opens the current folder through the existing local browser route.
- The new-thread folder dropdown shows the project folder immediately after navigation.
- Existing home-route folder selection is preserved when no active thread project resolves.
- New threads created from that composer are grouped under the same project.
- Light and dark theme controls remain readable.

## Rollback/Cleanup
- Stop the temporary Vite server if it was only used for this check.
