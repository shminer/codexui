### Selected skills visible on sent chat messages

#### Feature/Change Name
Selected composer skills are shown as skill chips on the user message after send/history load.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. At least one installed skill is available in the composer `Skills` dropdown
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open an existing thread or start a new thread.
2. Open the composer `Skills` dropdown and select one skill.
3. Type and send a short message.
4. Confirm the sent user message shows exactly one `Skill` chip with the selected skill name. Send another message with the same skill and confirm each message independently has one chip.
5. Click the skill chip and confirm the current browser tab opens the skill `SKILL.md` file through the local browse view.
6. Refresh, then reopen the thread and confirm each message still has exactly one visible and clickable chip for that skill.
7. Switch to dark theme and repeat steps 2-6 with another message.

#### Expected Results
- Selected skills are visible on the user message, not only in the composer before send.
- Skill chips show the skill name and expose the skill path in the tooltip.
- Skill chips link to the selected skill file using the local browse route in the current tab.
- Skill chips remain visible after thread history reload.
- Duplicate skill records with the same normalized path produce one chip per message; same-name skills at different paths remain distinct.
- Skill chips are readable in both light and dark themes.

#### Rollback/Cleanup
- Remove disposable test messages/threads if needed.

---
