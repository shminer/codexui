### Source files open in the existing editor

#### Prerequisites/Setup
- Existing local server; disposable C/C++, Markdown, HTML with relative CSS, image and binary files under an allowed root.
- Include a filename with spaces, Chinese characters, `#`, `%` and `?`; check both editable and safe read-only modes.

#### Steps
1. In TestChat send a unique marker and links to the files, then click each real message link and directory filename.
2. Confirm source/Markdown opens in the editor, C/C++ has syntax highlighting, and Raw opens the unchanged file.
3. Save a disposable edit in writable mode; refresh and confirm persistence. In read-only mode confirm Save is disabled and direct PUT remains rejected.
4. Confirm HTML relative assets and image preview still work. Try an out-of-root path and a source file larger than 10 MB.
5. Repeat in light and dark themes. Record TestChat `hrefOk`, `titleOk`, `textOk` and screenshot evidence.

#### Expected Results
- Text opens in the editor; preview/raw routes preserve HTML assets. Special characters identify the correct file.
- Read-only policy, canonical root checks and file-size limits remain enforced; saving errors are visible.

#### Rollback/Cleanup
- Revert disposable file edits and remove the test thread/files.
