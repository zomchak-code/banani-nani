# AI Screen Composer (Anthropic + shadcn)

This app generates **Screens** (rendered HTML) from natural language prompts, where every screen is composed of **reusable Components**.

## Setup

1) Install dependencies:

```bash
bun install
```

2) Set environment variables:

```bash
export ANTHROPIC_API_KEY="your_key_here"
```

Optional:

```bash
export ANTHROPIC_MODEL="claude-sonnet-4-20250514"
export ANTHROPIC_MAX_TOKENS="6000"
export ANTHROPIC_TEMPERATURE="0.2"
```

3) Run the dev server:

```bash
bun dev
```

Then open `http://localhost:3000`.

## How it works

- **Prompt box**: enter a request like “Dashboard showing sales metrics with a sidebar navigation”.
- The server route `src/app/api/generate/route.ts` calls Anthropic and returns **strict JSON**:
  - `action: "regenerate"` with a full new screen (components + layout), or
  - `action: "patch"` with a small set of component updates and/or layout operations.
- The client stores screen state in-memory as:
  - `components`: map of `componentId -> { name, html }`
  - `layout`: ordered array of componentIds
- The preview is rendered in a sandboxed iframe (`srcDoc`) with **Tailwind CDN** enabled.

## Reset

The Reset button clears message history, the current screen, and all components.

