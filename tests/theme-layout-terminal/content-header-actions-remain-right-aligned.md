### Content header actions remain right aligned

#### Feature/Change Name
Main conversation headers hide the visible title and new-chat pencil, place new conversation, search and resources in a left-aligned three-dot menu, and keep terminal, Git and agent controls independent on the right. Browser tab titles and other route headers retain their existing behavior.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. Sidebar collapsed or viewport wide enough to show content header actions
3. A thread with a project directory, terminal quick commands, searchable messages and resource links
4. Test at 1440×1000, 768×1024 and 375×812 in both themes and both UI languages
5. Automated mock coverage: `node scripts/verify-thread-header-actions.cjs` (no real conversation or terminal is created)

#### Steps
1. Open `http://127.0.0.1:4173/#/`
2. Inspect the header row containing `Start new thread`
3. Verify the terminal toggle is aligned to the far right of the content header, not immediately after the title
4. Open a thread with a long title. Confirm its visible header title, new-chat pencil and independent search/resource icons are absent; its browser tab still shows its title. The three-dot trigger is on the left, after the sidebar toggle when that toggle is visible; terminal, Git and agent controls remain on the right
5. Open the three-dot menu. Confirm it aligns with the trigger's left edge, fits the viewport and contains only New conversation, Find in thread, Thread resources (新建对话、会话内搜索、线程资源)
6. Use Arrow Up/Down, Home/End and Enter, and dismiss using Escape or an outside click. Confirm focus returns to the three-dot trigger; Tab closes the menu and continues navigation
7. Select search. Confirm autofocus, search for a known phrase and navigate to a match. Select resources and confirm search closes. Reference a file into the composer, then locate its source message. Close the panel and confirm no blank toolbar remains
8. Open the independent terminal dropdown on the right, execute a project quick command, then use the same dropdown to hide terminal with pointer/touch. Also open and hide it with the existing keyboard shortcut. Confirm the main thread terminal initially starts below the header, leaving the header controls reachable, and its dropdown options render above the floating terminal while expanded. When terminal support is unavailable, its independent button is absent and the three-dot menu still has its three actions
9. Switch threads with a panel/menu open and while search/resource requests are pending. Confirm the new thread has no leftover panel, highlight or old response. Enter Git review and confirm search/resources are disabled, then return to the conversation
10. Choose New conversation and confirm the project directory is retained. Check Home, Skills, Automations, sidebar new-chat controls, archived preview, subagent and side conversation entrances retain their existing layout
11. Repeat in every viewport/theme/language combination. Confirm no overlap or horizontal overflow, and dark menus/panels have dark surfaces
12. Inspect network requests: three-dot menu opening, empty search opening and resource projection from loaded messages must not read history, load resources or attach a terminal. Resource history loads only on explicit Load history/Refresh. The menu's outside-click listener is removed on close and unmount

#### Expected Results
- The three-dot menu uses the left side of the content header; terminal, Git and agent controls use the right side
- Home/Skills/Automations titles remain visible; the main conversation title only appears in the browser tab
- Terminal, Git and agent controls remain independent; the three menu actions reuse existing behavior. Terminal quick commands remain in the independent terminal dropdown
- Main search/resources are mutually exclusive and leave no toolbar space after closing
- Thread changes and review mode cannot retain a stale menu/panel or apply stale responses
- The mock script saves menu, search and resources screenshots for all 12 combinations plus request/size results under `output/playwright/thread-header-*`

#### Verification Results
- The left-menu/independent-terminal change passed all 12 viewport/theme/language combinations, plus terminal-unavailable and missing-thread checks. There are 36 verified screenshots; request evidence is in `output/playwright/thread-header-actions-results.json`.
- Pointer selection of a terminal quick command and Hide terminal passed with the floating terminal open. The terminal dropdown uses an opt-in body teleport at layer 270; other dropdowns keep their existing host. Inside-menu pointer events remain inside the dropdown, and the previous popup sizing and dark-theme styles are preserved.
- Opening the three-dot menu added zero expensive requests in every combination. The existing search/resource/history request boundaries and close/unmount listener cleanup passed. These small mocked payloads are not a production load or heap-retention benchmark.
- The six focused layout, conversation, terminal, subagent, side-conversation and floating-window test files passed all 22 cases. No-emit type checking, script syntax checking and `git diff --check` passed. Full unit suite, build and release were not run for this layout change.

#### Rollback/Cleanup
- Remove generated screenshots under `output/playwright/` if they are not needed
- Remove test search text and referenced draft attachments; hide any manually opened terminal. The mock run writes only temporary browser-context state

---
