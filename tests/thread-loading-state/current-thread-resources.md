### Current Thread Resources

#### Prerequisites/Setup
- A disposable thread with more than 50 native items, uploaded files/images, generated images with saved paths, file changes, and Markdown/inline-code file references.
- Include relative paths, spaces, Chinese characters, literal `%20`, and parentheses in a file name; include duplicate references to the same path and a missing file.
- Use files inside and outside the configured roots. Keep another thread available for switching checks.

#### Steps
1. Open the thread without opening Resources. Confirm no resource-history request occurs during thread startup or token streaming.
2. In the main conversation, open the left three-dot menu and select Thread resources (线程资源). Inspect Attachments and Related files. Confirm currently loaded attachments, images, generated files, changed files, and linked files appear with duplicates merged by normalized path/URL.
3. Click Load history, then Load more. Inspect `/codex-api/thread-resources`: each page contains metadata and a cursor, with no message bodies or base64 image payloads. Confirm coverage changes from Partial history to History loaded only when pagination ends.
4. Open a source/Markdown file, an image and an HTML file. Confirm editing versus preview dispatch is correct. Download a disposable resource and check the file content/name.
5. Reference a local resource and a remote image URL. Confirm only the composer draft changes, no message is sent, and repeated local references are deduplicated. Missing/out-of-root local files produce an error rather than entering the draft.
6. Locate a resource in a loaded message, then one outside the recent window. Confirm the correct source message is visible and highlighted; only the selected source message is loaded on demand.
7. Delay a history/source/reference response, switch threads, then release it. Confirm the new thread does not show old resources, scroll to an old message, or receive a stale draft attachment.
8. Refresh the resource list after adding a file. Confirm history restarts with no stale pages or permanent cross-request cache. Simulate unsupported native item pagination versus authentication/network errors; only explicit unsupported errors fall back to loaded resources.
9. Repeat the changed UI at 1440x900, 768x1024 and 375x812 in light and dark themes. Check panel bounds, labels, search controls and resource action buttons for overlap/overflow.

#### Expected Results
- Resources cover only the current thread and are grouped without duplicate files. Base64/blob inputs do not become file paths or metadata payloads.
- Opening, downloading and referencing reuse existing filesystem policy checks. Referencing only updates the draft.
- History is explicit and paged; source reads are restricted to the selected turn. No per-resource preflight requests occur when merely opening the list.
- Thread switches invalidate pending UI results, and loading/error/unsupported states remain distinguishable.

#### Rollback/Cleanup
- Remove the disposable thread, uploaded/downloaded files and draft references; revert any test file edits.
