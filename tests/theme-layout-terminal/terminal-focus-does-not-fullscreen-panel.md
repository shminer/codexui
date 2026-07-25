### Terminal focus preserves floating window

#### Feature/Change Name
Terminal focus on mobile keeps the user-controlled floating terminal geometry instead of forcing it to full screen.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. A thread or new-chat project with the terminal toggle available
3. Mobile viewport or Android device browser

#### Steps
1. Open a thread or new chat with a valid project path
2. Tap the terminal toggle
3. Drag the terminal to a visible position and resize it
4. Tap inside the terminal area
5. If the virtual keyboard appears, keep focus in the terminal
6. Hide and reopen the terminal

#### Expected Results
- Terminal retains its floating position and size instead of being forced to full screen
- Conversation/new-chat content remains visible behind the non-modal terminal window
- The title bar and Close action remain within the available viewport when the keyboard changes size
- Hiding and reopening the terminal restores the default floating geometry

#### Rollback/Cleanup
- Close the terminal panel

---
