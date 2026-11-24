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

- **Chat** (left): talk to Sonnet like any AI assistant. It has Claude Code's full toolset: it reads, writes and moves files in any folder, runs commands, installs packages, uses git (including push), searches the web and uses your connectors. It does small jobs itself; for big builds it writes a full brief, picks the flow and the skills, and starts the build team. Chats are saved in `sessions/`, and each one is linked to a project in `projects/<name>`.
- **Permission mode** (per chat, next to the project):
  - **Ask first** (default): commands, file changes and other risky actions show an Allow / Always allow / Deny card in the chat and wait for you. Read-only commands run without asking.
  - **Auto-accept edits**: file edits run directly; commands still ask.
  - **Full access**: everything runs without asking.
- **Connectors** (plug icon): every MCP server your `claude` CLI can see: claude.ai connectors (like Astrocade), plugin servers and local ones. Switched-on connectors work in the chat and for the Claude build agents. **Sign in...** opens Claude Code in a new window; type `/mcp` there to sign in to a connector, then press **Refresh**.
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

## Flows: who does what

Sonnet reads each request and sends it through the shortest process that does the job well:

| Request | What runs |
|---|---|
| New game | **game**: plan (Fable) → code (Opus) → review (Sol) → thumbnail (Astra) |
| New e-commerce shop, dashboard, admin panel, booking app | **webapp**: plan → code → test (Sol) → security review (Astra) |
| New landing page, portfolio, company site, blog | **website**: plan → code → review for mobile, accessibility and SEO (Sol) → images (Astra) |
| New backend, API, script, tool, system | **system**: plan → code → test (Sol) → review (Astra) |
| Anything else that's new | **default**: plan → code → review (Sol) |
| A preset that almost fits | The preset with steps added or removed. Sonnet says what it changed. |
| A follow-up, such as a new color, layout, animation or a bug fix | Straight to **code (Opus)**, with no planning |
| "Do a security review" | Straight to **Astra** |
| Tests or a code review | Straight to **Sol** |
| New images, icons or a thumbnail | Straight to **Astra** |
| A follow-up that needs design decisions | **plan (Fable)** → **code (Opus)** |

Questions, git work and tiny edits Sonnet does itself.

## Change who does what

Edit `flows.json`, then restart the app:

- `agents` sets the CLI (`claude` or `codex`) and the model for each agent.
- `chat` names the agent you chat with (Sonnet by default; it must use the `claude` CLI).
- `flows` lists each flow's steps and the agent for each step. `about` tells Sonnet when to use the flow. `match` holds the keywords the terminal command uses to pick a flow.

## Safety

The server listens on 127.0.0.1 only and rejects requests from other websites. The app's own file editor can only read or save inside a project folder.

The chat agent can act on your whole computer, limited by the chat's permission mode. In **Ask first** its approval requests go through `approve-mcp.mjs`, a small local MCP server that asks you in the app; it reaches the app with a token that changes every time Orchestra starts. Publishing tools (Astrocade's `publish_game`) always ask first in chat, even in Full access, and are never allowed for build agents. Codex agents use their own setup (`~/.codex`), not Orchestra's connector switches.

Your connector switches are saved in `settings.json`, and per-run permission files go in `.orchestra/`. Neither is in git. Agents run with file-edit permission inside the project folder: Claude uses `acceptEdits`, and Codex uses the `workspace-write` sandbox.

## Tests

```
node test.mjs
```
