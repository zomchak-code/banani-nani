import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { loadPrompt } from "braintrust";
import { NextResponse } from "next/server";
import { z } from "zod";
import { agentResponseSchema, screenStateSchema } from "@/lib/screenSchema";

export const runtime = "nodejs";

const JSON_FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(10_000),
});

const generateRequestSchema = z.object({
  prompt: z.string().min(1).max(10_000),
  messages: z.array(messageSchema).max(50).default([]),
  screen: screenStateSchema.optional(),
});

function extractJson(text: string): string {
  let trimmed = text.trim();

  // strip ```json fences if present
  const fence = trimmed.match(JSON_FENCE_RE);
  if (fence?.[1]) {
    return fence[1].trim();
  }

  // strip opening fence even if the closing fence is missing (common when output is truncated)
  if (trimmed.startsWith("```")) {
    const firstNewline = trimmed.indexOf("\n");
    if (firstNewline !== -1) {
      trimmed = trimmed.slice(firstNewline + 1).trim();
    }
    const trailingFence = trimmed.lastIndexOf("```");
    if (trailingFence !== -1) {
      trimmed = trimmed.slice(0, trailingFence).trim();
    }
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1).trim();
  }

  return trimmed;
}

async function getSystemPrompt() {
  const prompt = await loadPrompt({
    projectName: process.env.BRAINTRUST_PROJECT_NAME,
    slug: process.env.BRAINTRUST_PROMPT_SLUG,
  });
  const built = prompt.build({});
  const content = built.messages?.[0]?.content;
  const text = typeof content === "string" ? content : JSON.stringify(content);
  console.log(text);
  return text;
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY in environment" },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedReq = generateRequestSchema.safeParse(body);
  if (!parsedReq.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsedReq.error.flatten() },
      { status: 400 }
    );
  }

  const { prompt, messages, screen } = parsedReq.data;

  const model = "claude-haiku-4-5";
  const max_tokens = Number(process.env.ANTHROPIC_MAX_TOKENS ?? "6000");
  const temperature = Number(process.env.ANTHROPIC_TEMPERATURE ?? "0.2");

  const userContext = [
    "Current screen state (if any):",
    screen ? JSON.stringify(screen, null, 2) : "null",
    "",
    "Conversation history:",
    JSON.stringify(messages, null, 2),
    "",
    "New user request:",
    prompt,
  ].join("\n");

  try {
    const result = await generateText({
      model: anthropic(model),
      system: await getSystemPrompt(),
      prompt: userContext,
      temperature,
      maxOutputTokens: max_tokens,
    });

    const jsonText = extractJson(result.text);
    let json: unknown;
    try {
      json = JSON.parse(jsonText);
    } catch {
      const looksTruncated =
        result.text.includes("```json") && !result.text.trim().endsWith("}");
      return NextResponse.json(
        {
          error: "Model did not return valid JSON",
          raw: result.text,
          hint: looksTruncated
            ? "The model output looks truncated (likely max tokens too low). Increase ANTHROPIC_MAX_TOKENS or ask for a simpler screen."
            : "The model returned malformed JSON. Try again or simplify the request.",
        },
        { status: 502 }
      );
    }

    const parsed = agentResponseSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Model JSON failed schema validation",
          details: parsed.error.flatten(),
          raw: json,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(parsed.data);
  } catch (err) {
    return NextResponse.json(
      {
        error: "AI SDK generation failed",
        model,
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
