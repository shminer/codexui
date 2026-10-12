### Content header actions remain right aligned

#### Feature/Change Name
Main conversation headers hide the visible title and new-chat pencil, keep Git and agent controls, and place new conversation, terminal, search and resources in a right-aligned three-dot menu. Browser tab titles and other route headers retain their existing behavior.

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
4. Open a thread with a long title. Confirm its visible header title, new-chat pencil and independent terminal/search/resource icons are absent; its browser tab still shows its title
5. Open the three-dot menu. Confirm the order is New conversation, Terminal, Find in thread, Thread resources (新建对话、终端、会话内搜索、线程资源)
6. Use Arrow Up/Down, Home/End and Enter; enter the terminal submenu with click or Arrow Right, return using Back or Arrow Left, and dismiss using Escape or an outside click. Confirm focus returns to the three-dot trigger; Tab closes the menu and continues navigation
7. Select search. Confirm autofocus, search for a known phrase and navigate to a match. Select resources and confirm search closes. Reference a file into the composer, then locate its source message. Close the panel and confirm no blank toolbar remains
8. Open terminal, execute a project quick command, then use the submenu to hide terminal. Confirm the floating terminal cannot cover the opened action menu
9. Switch threads with a panel/menu open and while search/resource requests are pending. Confirm the new thread has no leftover panel, highlight or old response. Enter Git review and confirm search/resources are disabled, then return to the conversation
10. Choose New conversation and confirm the project directory is retained. Check Home, Skills, Automations, sidebar new-chat controls, archived preview, subagent and side conversation entrances retain their existing layout
11. Repeat in every viewport/theme/language combination. Confirm no overlap or horizontal overflow, and dark menus/panels have dark surfaces
12. Inspect network requests: menu opening, submenu navigation, empty search opening and resource projection from loaded messages must not read history, load resources or attach a terminal. Resource history loads only on explicit Load history/Refresh. The menu's outside-click listener is removed on close and unmount

#### Expected Results
- Header actions use the available right edge of the content header
- Home/Skills/Automations titles remain visible; the main conversation title only appears in the browser tab
- Git and agent controls remain independent; the four menu actions reuse existing behavior
- Main search/resources are mutually exclusive and leave no toolbar space after closing
- Thread changes and review mode cannot retain a stale menu/panel or apply stale responses
- The mock script saves menu, search and resources screenshots for all 12 combinations plus request/size results under `output/playwright/thread-header-*`

#### Rollback/Cleanup
- Remove generated screenshots under `output/playwright/` if they are not needed
- Remove test search text and referenced draft attachments; hide any manually opened terminal. The mock run writes only temporary browser-context state

---
