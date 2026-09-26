### User message click-to-copy

#### Feature/Change Name
Click user message text to reveal Copy in the existing message toolbar. Copy preserves the complete original text; editing and assistant response copy are unchanged.

#### Prerequisites/Setup
1. Use a disposable conversation with two user messages, one containing leading/trailing spaces, multiple lines, Markdown, a link, and a fenced code block.
2. Add an image-only user message and a message containing both text and an image.
3. Have access to a clipboard paste target. Check light and dark themes on desktop and at 375x812 and 768x1024.

#### Steps And Expected Results
1. Click the first user message text: an icon and Copy appear below that message. Moving the pointer away leaves Copy visible. Click the text again: Copy disappears; existing Edit message behavior is unchanged.
2. Reveal Copy for the first message, then click the second: only the second message shows Copy.
3. Click Copy and paste into the external target: text matches the original exactly, including spaces, line breaks, and Markdown source. No timestamp, attachment data, or assistant text is appended. The button reads Copied for about 1.8 seconds, then Copy, without changing width.
4. Select text with a drag or mobile long press, open a message link, and use the fenced code block copy button: each original interaction works without revealing or toggling the whole-message Copy.
5. Tab to the dedicated Show message copy action button: it becomes visible on focus. Enter or Space expands or collapses Copy using native button behavior, and its expanded state matches the toolbar. The screen reader's button navigation can find this entry even in a read-only conversation. Activate the toolbar Copy button: clipboard contents match the whole message. The rich text itself remains ordinary content; nested links and code buttons retain their own semantics and keyboard behavior.
6. Start a response, and separately open a read-only conversation or use a runtime without history-edit support: user text can still be copied. Image-only and whitespace-only messages have no whole-message Copy; a text-and-image message copies only its text.
7. Deny clipboard writes and make the selection fallback fail: the button does not show Copied. Restore clipboard access and retry: copying succeeds.
8. Reveal Copy and switch conversations: the new conversation has no expanded Copy or stale Copied feedback. Repeat while a clipboard write is pending, including switching away and back before it completes: its late success or failure must not restore feedback. Start two copies and complete the older write last; the newer copy feedback remains current.
9. Confirm assistant reply Copy still copies its existing combined response content. In both themes, the new button uses the existing normal and copied colors. On touch devices it has at least a 32px height and text does not overlap.

#### Performance Audit
Code-path review: one expanded message ID is added; user copy reads the current message text directly. No API requests, whole-history lookup, extra Markdown parsing, or dependencies are added. The native toggle is separate from the rich text, so toggling does not invalidate its render memo. The existing clipboard fallback and one feedback timer are reused; a generation counter discards stale feedback after reset or a newer copy, without extra requests or timers. Browser timing, clipboard behavior, theme rendering, and responsive layout require runtime verification and were not measured during implementation.

#### Automated Regression Coverage
`messageCopyController.test.ts` directly calls the production interaction and clipboard handlers with mocked targets, selection, clipboard writes, and fake timers. Cases cover toggle/switch behavior, empty and image-only messages, interactive descendants, selected text, exact clipboard text, success and failure, assistant response copy, 1800ms feedback, late async completion, and timer cleanup. The wiring test separately checks the native button and component lifecycle connections. These tests were added but not executed under the static-only verification constraint.

#### Rollback/Cleanup
Archive the disposable conversation, remove its test attachments, restore clipboard permissions, and clear the pasted clipboard content. Revert the feature commit to remove the new entry point without changing stored conversation data.
