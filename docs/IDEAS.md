# Ideas

Ideas we have discussed but not built. Each entry says what the idea is and why it waits. When an idea is built, delete its entry.

## Next


## Parked

- **Pacing in interview mode.** Each step gets a time budget, and the interviewer moves the candidate on when a step runs over. Waits until the guided-mode and Today-page changes land.
- **Audio cues for pacing.** A soft sound when a step reaches its budget, so the candidate feels the clock without looking at it. Depends on pacing.
- **Desktop app.** A Rust shell (Tauri) owns the window and starts the Node server as a hidden child process. The user opens one app and sees no terminal, browser tab or port. The UI stays web: Excalidraw and Monaco are web-only, and the model driver needs Node. The shell uses the system webview (WebKit on macOS), and the app is tested only in Chrome today, so the first step is a WebKit test pass. Electron is the fallback if WebKit renders badly. Smoother animations are frontend work and do not depend on the shell. Open scope: which operating systems, personal use or public download (signing, bundled Node), whether browser mode stays, and what "immersive" means in concrete terms. Waits until the scope is settled.
- **AI-assisted development round.** A practice round in the format that companies now add to their assessments: the candidate builds or fixes a feature in a small codebase with an AI coding assistant available. The judge scores how the candidate uses the assistant — task breakdown, prompts, review of generated code, tests, and catching the assistant's mistakes — as well as the result. Waits until the scope is settled: the languages, the shape of the starter codebases, and which assistant the candidate uses inside the room.
