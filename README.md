# Orchestra

Give it a job. It runs the job through a flow of steps and switches to the right AI agent and model for each step automatically.

```
"make a space shooter game"
  plan       → Claude Fable 5.2   writes PLAN.md
  code       → Claude Opus 5.5    builds the game from PLAN.md
  review     → GPT-6.2 Sol        checks and fixes the code, writes REVIEW.md
  thumbnail  → GPT-6.2 Astra      makes thumbnail.png
```

Agents hand work to each other through files in the project folder.

## Requirements

- [Node.js](https://nodejs.org) 22+
- [Claude Code](https://claude.com/product/claude-code), signed in (`claude auth login`)
- [Codex CLI](https://developers.openai.com/codex/cli), signed in (`npm install -g @openai/codex`, then `codex login`)

No npm packages are needed.

## Run the app

Double-click `Orchestra.cmd` on Windows, or run:

```
node server.mjs
```

It opens at http://127.0.0.1:4545. On Windows it opens as an Edge app window; pass `--no-open` to skip that. Keep the console window open while you use it.

The app works like a chat plus an IDE:

- **Chat** (left): talk to Sonnet. Ask questions about the project, get advice, or ask for something to be built or changed. Sonnet can read the project's files but never edits them. When you want work done, it writes a full brief, picks the flow and the skills, and starts the build. Chats are saved in `sessions/`, and each one is linked to a project in `projects/<name>`.
- **Builds**: the pipeline shows at the top (plan, code, review, ...). **Stop build** ends it. A failed or stopped build can be retried from the step that failed.
- **Preview**: runs the project's `index.html`. It is served from port 4546, a separate origin, so a previewed page cannot use Orchestra's controls.
- **Code**: a file explorer and the VS Code editor (Monaco). Edit any file and press Ctrl+S to save. Add a `RULES.md` to a project to give every agent project rules.
- **Output**: the agents' live output.
- **Skills** (star icon): reusable guidance in `skills/*.md`. Add, edit or upload them; Sonnet picks the ones that fit each build.

The editor and Markdown rendering load from cdnjs, so the Code tab needs internet. Without it, files open in a plain text box.

## Run from the terminal

```
node orchestra.mjs "make a snake game" --dir ./snake --skills web-game,clean-code
```

| Option | What it does |
|---|---|
| `--flow game` | Force a flow instead of picking by keywords |
| `--from code` | Resume from a step |
| `--skills a,b` | Apply skills from `skills/` |
| `--dry` | Show which agent runs each step without running anything |

## Change who does what

Edit `flows.json`, then restart the app:

- `agents` sets the CLI (`claude` or `codex`) and the model for each agent.
- `chat` names the agent you chat with (Sonnet by default; it must use the `claude` CLI).
- `flows` lists each flow's steps and the agent for each step. `about` tells Sonnet when to use the flow. `match` holds the keywords the terminal command uses to pick a flow.

## Safety

The server listens on 127.0.0.1 only and rejects requests from other websites. The chat agent only gets read tools (Read, Glob, Grep). Files can only be read or saved inside a project folder. Agents run with file-edit permission inside the project folder: Claude uses `acceptEdits`, and Codex uses the `workspace-write` sandbox.

## Tests

```
node test.mjs
```
