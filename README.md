# AI Screen Composer (Anthropic + shadcn)

This app generates **Screens** (rendered HTML) from natural language prompts, where every screen is composed of **reusable Components**.

## Setup

1) Install dependencies:

```bash
bun install
```

2) Set environment variables:

```bash
ANTHROPIC_API_KEY=anthropic-api-key

BRAINTRUST_API_KEY=braintrust-api-key
BRAINTRUST_PROMPT_SLUG=braintrust-prompt-slug
BRAINTRUST_PROJECT_NAME=braintrust-project-name
```

3) Run the dev server:

```bash
bun dev
```

Open `http://localhost:3000`.