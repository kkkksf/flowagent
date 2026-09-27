# FlowAgent Design Spec

Date: 2026-09-28
Status: Approved in brainstorming, pending user review

## 1. Purpose & Goals

FlowAgent is a desktop AI coding application similar to ZCode/Trae: an agent
that chats, reads/writes files, runs commands, and completes multi-step tasks
autonomously — with a built-in text editor (the capability ZCode lacks).

Two goals, both first-class:

1. **Learn agent internals** — the agent loop, tool calling, context
   management must be readable and hackable as a standalone library.
2. **Daily personal use** — stable and practical enough for real work.

Non-goals (v1): multi-user, cloud deployment, local models (Ollama/vLLM),
plugin marketplace, remote workspaces.

## 2. Chosen Approach

**Electron + React + Monaco + Node, all TypeScript.**

Alternatives rejected:

- *Code-OSS fork* (what Trae did): full IDE from day one, but the agent core
  gets buried in the extension system — worst for learning — and tracking
  upstream is a long-term burden.
- *Tauri + Node sidecar*: smaller footprint, but adds Rust plus process
  management/packaging pitfalls with no learning benefit.

## 3. Architecture

pnpm monorepo, three packages with a strict one-way dependency rule
(renderer → main → core; reverse imports forbidden):

```
flowagent/
├── packages/
│   ├── agent-core/        # pure TS library, zero UI/Electron deps
│   │   ├── loop.ts        # agent loop: LLM <-> tools reason-act cycle
│   │   ├── tools/         # tool registry + implementations
│   │   ├── context/       # context management: trimming, compaction
│   │   ├── providers/     # OpenAI-compatible API client
│   │   └── session/       # session persistence (append-only JSONL)
│   ├── main/              # Electron main: window, IPC, node-pty terminals
│   └── renderer/          # React UI: chat panel + Monaco + file tree + terminal
├── pnpm-workspace.yaml
└── package.json
```

Key decisions:

- **agent-core is the first citizen.** It imports nothing from
  Electron/React; its inputs/outputs are pure data (messages, tool calls,
  event streams). It can be driven and tested from a plain Node script
  without launching Electron.
- **Event-stream driven.** Core exposes an async iterator/event bus emitting
  `message-delta`, `tool-call`, `tool-result`, `done`. The renderer
  subscribes via IPC; streaming output and tool progress are all events.

## 4. Agent Core

### 4.1 Main loop

```
user message -> append to history -> call LLM (streaming)
  |- text output      -> stream to UI
  |- tool_calls       -> execute each (through approval gate)
                          -> append results to history -> call LLM again
loop until the model requests no more tools or the step cap is reached
```

- Default step cap: 30 (configurable) to prevent runaway loops.
- Each turn is a serializable state transition
  `(history, model_output) -> history'`, enabling save/resume at any point.

### 4.2 Tools (v1 scope)

| Tool | Notes |
|---|---|
| `read_file` / `write_file` / `edit_file` | exact-string-replace editing |
| `list_dir` / `glob` / `grep` | discovery and search |
| `run_command` | shell execution, configurable timeout, truncated output |
| `todo` | task-list read/write so the agent tracks its own progress |

### 4.3 Safety & approval gates

- `write_file`, `edit_file`, `run_command` require user confirmation by
  default; the UI offers "auto-allow for this session". Read-only tools pass
  through.
- Paths outside the workspace root are always rejected.
- `run_command` has a hard timeout plus an output size cap.

### 4.4 Context management

- v1: token-budget trimming — old tool results compressed (truncated to
  summaries) first, then oldest turns dropped; system prompt and the most
  recent N turns are always kept.
- The interface is a replaceable `ContextStrategy`, so LLM-driven
  auto-compaction can be added later without touching the loop.

### 4.5 Provider

- Single `OpenAICompatProvider`: `baseURL` + `apiKey` + `model`. Multiple
  named profiles (deepseek / glm / qwen), switchable in the UI.

## 5. UI Layout & Interaction

```
+--------+---------------------------+---------------+
| file   |  editor (Monaco, tabs)    |  agent panel  |
| tree   |                           |  -----------  |
|        |                           |  chat stream: |
|        |                           |   text (stream)
|        +---------------------------+   tool cards
|        |  terminal (xterm.js)      |   diff preview|
+--------+---------------------------+---------------+
```

- Agent panel is the chat surface: streaming markdown text; each tool call
  renders as a collapsible card (tool name + args + result summary);
  `edit_file`/`write_file` cards embed a Monaco DiffEditor — the file is
  written only after the user clicks approve (this is the approval gate).
- Editor linkage: files changed by the agent refresh their tabs; clicking a
  file path in a tool card opens it.
- Terminal: the agent's `run_command` executes in the real terminal pane;
  the user shares the same pty session pool.
- Top bar: model profile switcher, session list (restored from JSONL),
  token usage.
- First-run flow: pick a folder as the workspace; sessions are bound to the
  workspace path.

## 6. Data Flow (one tool call, end to end)

```
LLM streams a tool_call
  -> core emits tool-call event -> main forwards over IPC -> renderer
  -> if approval needed: UI shows diff/command card, user approves
     -> IPC back to main -> core receives the go-ahead
  -> core executes tool -> tool-result event flows back
  -> result appended to history -> loop continues
Every step is appended to the session JSONL synchronously;
a crash can be resumed on reopen.
```

## 7. Error Handling

- **LLM API failure:** exponential backoff, 3 retries (429/5xx). If still
  failing, report to the UI and mark the turn failed — history stays clean;
  the user can retry.
- **Tool execution failure:** the error text is returned to the model as the
  tool result (part of the loop, not an exception); the model decides to
  retry or change approach.
- **Invalid tool arguments:** JSON-schema validation failure returns an
  error message without executing.
- **User stop:** interrupt the loop (finish the current tool but skip the
  next LLM call); the session is kept.

## 8. Testing Strategy

- `agent-core` unit tests are the backbone: a **fake provider** (scripted
  tool_call sequences) drives the loop; assert history evolution and event
  ordering — full loop coverage with zero API cost.
- Tool unit tests run against temp directories.
- main/renderer get smoke tests only: app boots, window opens, IPC works.

## 9. Milestones

- **M1 — agent-core CLI-usable:** chat + tools work from a terminal, no UI.
- **M2 — Electron shell + chat panel:** streaming chat and tool cards in the
  desktop app.
- **M3 — Monaco editor + diff approval:** file tree, tabs, diff-based write
  approval.
- **M4 — terminal + session restore:** xterm pane, session list/resume.

Each milestone ends with something genuinely usable.
