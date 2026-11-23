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

In the app:

- **Job**: what to build.
- **Project folder**: where it is built. Defaults to `projects/<job-name>`.
- **Flow**: `Auto` picks one by keywords in the job.
- **Project rules**: saved as `RULES.md` in the project folder and followed by every agent.
- **Skills**: reusable guidance in `skills/*.md`. Tick the ones to apply, add or edit them in the app, or upload a `.md` file.

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
- `flows` lists each flow's steps and the agent for each step. `match` holds the keywords that pick the flow automatically.

## Safety

The server listens on 127.0.0.1 only and rejects requests from other websites. Agents run with file-edit permission inside the project folder: Claude uses `acceptEdits`, and Codex uses the `workspace-write` sandbox.

## Tests

```
node test.mjs
```
