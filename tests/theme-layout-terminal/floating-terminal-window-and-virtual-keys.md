### Floating terminal window and virtual keys

#### Feature/Change Name
The integrated Bash terminal is a draggable, resizable floating window on desktop and mobile, with a bottom shortcut row for common terminal control keys.

#### Prerequisites/Setup
1. App server running from this repository.
2. A thread or new chat with a selected local project folder.
3. Integrated terminal available from the header terminal command control.

#### Steps
1. Open the terminal and confirm it appears as a floating window above the conversation.
2. On a desktop viewport, drag an empty part of the terminal title bar to each screen edge.
3. Confirm the whole window, including the title bar and Close action, remains visible at every edge.
4. Drag the bottom-right resize grip wider, narrower, taller, and shorter.
5. Confirm the xterm grid refits without clipped prompt text and the Bash session remains connected.
6. Open a second terminal tab, switch tabs, and resize the window again.
7. Confirm only the active session receives the new terminal grid size and neither session is restarted.
8. In the bottom shortcut row, press Tab, Esc, PgUp, PgDn, and each direction key while Bash is focused.
9. Confirm each press is accepted once by the active PTY and the xterm cursor remains focused after the press.
10. Tap Ctrl, then tap C; confirm the active Bash command is interrupted and Ctrl returns to its inactive appearance immediately.
11. Repeat step 10 with one direction key, PgUp, and PgDn.
12. On a narrow touch viewport, drag the title bar and resize grip with touch input; rotate, pinch-zoom, or otherwise offset the visual viewport while the terminal is open.
13. Open the virtual keyboard, then confirm the floating terminal is clamped inside the visible viewport with its title bar and Close action still available.
14. Switch the app between light and dark themes and repeat steps 1 through 5.
15. Hide the terminal, reopen it, and confirm it starts at the default centered geometry rather than restoring the prior drag or resize state.

#### Expected Results
- The terminal is a non-modal floating window above the application header and conversation, while Diff overlays remain above the terminal.
- Title-bar dragging and bottom-right resizing work with mouse and touch without activating terminal tabs or header actions accidentally.
- Window geometry never extends beyond the visible viewport after dragging, resizing, orientation changes, pinch zoom, visual-viewport offsets, or virtual-keyboard changes.
- The xterm grid fits its visible host and reports only changed column or row dimensions to the active PTY.
- Tab, Ctrl+C, Esc, PgUp, PgDn, and all four direction controls send one input each to the active session.
- Ctrl applies only to the next bottom-row virtual key, then resets; physical keyboard Ctrl combinations remain native xterm input.
- Existing New, Hide, Close, tab switching, quick commands, terminal output, and error handling remain usable.

#### Rollback/Cleanup
- Close terminal tabs created for this test, then hide the floating terminal.
