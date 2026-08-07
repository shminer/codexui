### Composer expands long drafts to full screen

#### Feature/Change Name
Thread composer full-screen expand control for multi-line drafts.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. Any existing thread is open and send controls are enabled
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, type or paste at least six lines into the composer.
2. Confirm the expand button appears in the composer input area.
3. Click the expand button.
4. Confirm the composer fills the viewport below the fixed top header, keeps the draft text, and leaves the top-right collapse control plus model/skill/thinking/send controls usable.
5. Click the collapse button.
6. Confirm the composer returns to its normal inline size with the draft still intact.
7. Switch to dark theme and repeat steps 1-6.

#### Expected Results
- Short drafts do not show the expand control.
- Long or overflowing drafts show an icon-only expand control.
- Full-screen mode uses the same draft state and submit controls as inline mode.
- Full-screen and inline states are readable in light theme and dark theme.
- Full-screen mode starts below the 48px mobile or 56px desktop top header, so the collapse control is never covered.

#### Rollback/Cleanup
- Clear the draft from the composer.

---
