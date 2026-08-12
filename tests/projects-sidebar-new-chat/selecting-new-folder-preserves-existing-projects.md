### Selecting a new folder preserves existing sidebar projects

#### Prerequisites
- App is running from this repository.
- Thread history contains at least two local projects that are visible in the sidebar.
- A third local folder exists and is not yet shown as a project.

#### Steps
1. Start a new chat and open the existing-folder picker.
2. Select the third local folder and confirm the selection.
3. Wait for the folder picker to close and the sidebar refresh to finish.
4. Confirm the selected folder is first in the project list.
5. Confirm both previously visible local projects remain in the sidebar without selecting their folders again.
6. Refresh the page and repeat the sidebar checks.
7. Repeat the flow once in the light theme and once in the dark theme.
8. Make the workspace-roots save request fail and select another folder.

#### Expected Results
- Selecting the new folder does not clear or hide projects discovered from existing thread history.
- The selected folder is persisted first while all visible historical local project roots are retained in workspace roots and project order.
- Projectless chat folders are not added as workspace projects.
- Remote project IDs retain their existing project-order behavior.
- Reloading preserves the same sidebar project set and order.
- A workspace-roots save failure remains visible in the picker, reports the existing error, and does not continue with a sidebar refresh or close the picker.

#### Rollback/Cleanup
- Remove the test project from the sidebar if it is no longer needed.
