import { anthropic } from "@ai-sdk/anthropic";
import { generateText, hasToolCall, stepCountIs, tool } from "ai";
import { loadPrompt } from "braintrust";
import { NextResponse } from "next/server";
import { z } from "zod";
import { applyPatch } from "@/lib/applyPatch";
import type { Patch, ScreenState } from "@/lib/screenSchema";
import { componentIdSchema, screenStateSchema } from "@/lib/screenSchema";

export const runtime = "nodejs";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(10_000),
});

const generateRequestSchema = z.object({
  prompt: z.string().min(1).max(10_000),
  messages: z.array(messageSchema).max(50).default([]),
  screen: screenStateSchema.optional(),
});

async function getSystemPrompt() {
  const prompt = await loadPrompt({
    projectName: process.env.BRAINTRUST_PROJECT_NAME,
    slug: process.env.BRAINTRUST_PROMPT_SLUG,
  });
  const built = prompt.build({});
  const content = built.messages?.[0]?.content;
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return text;
}

function makePatch(partial: Partial<Patch>): Patch {
  return {
    upsert_components: partial.upsert_components ?? [],
    delete_components: partial.delete_components ?? [],
    layout_patch: partial.layout_patch ?? [],
    title: partial.title,
    globalCss: partial.globalCss,
  };
}

function encodeSseEvent(event: string, data: unknown): Uint8Array {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return new TextEncoder().encode(`event: ${event}\ndata: ${payload}\n\n`);
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

  let currentScreen: ScreenState = screen ?? { components: {}, layout: [] };
  let finalSummary: string | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encodeSseEvent(event, data));
      };

      try {
        send("ready", { ok: true });

        const applyAndEmitPatch = (patch: Patch) => {
          currentScreen = applyPatch(currentScreen, patch);
          send("patch", { patch });
        };

        const tools = {
          upsertComponent: tool({
            description:
              "Create or update a reusable component. Styling must be Tailwind classes within HTML. No <script> tags or inline event handlers.",
            inputSchema: z.object({
              id: componentIdSchema,
              name: z.string().min(1).max(80),
              html: z.string().min(1).max(50_000),
            }),
            execute: ({ id, name, html }) => {
              send("tool_call", {
                toolName: "upsertComponent",
                input: { id, name },
              });
              applyAndEmitPatch(
                makePatch({ upsert_components: [{ id, name, html }] })
              );
              return { ok: true, id };
            },
          }),
          deleteComponent: tool({
            description:
              "Delete a component entirely. This also removes it from the layout.",
            inputSchema: z.object({
              id: componentIdSchema,
            }),
            execute: ({ id }) => {
              send("tool_call", { toolName: "deleteComponent", input: { id } });
              applyAndEmitPatch(makePatch({ delete_components: [id] }));
              return { ok: true, id };
            },
          }),
          layoutInsert: tool({
            description:
              "Insert a component into the layout at the given index. Use index 9999 to append.",
            inputSchema: z.object({
              component_id: componentIdSchema,
              index: z.number().int().min(0),
            }),
            execute: ({ component_id, index }) => {
              send("tool_call", {
                toolName: "layoutInsert",
                input: { component_id, index },
              });
              applyAndEmitPatch(
                makePatch({
                  layout_patch: [{ op: "insert", component_id, index }],
                })
              );
              return { ok: true };
            },
          }),
          layoutMove: tool({
            description: "Move an existing layout component to a new index.",
            inputSchema: z.object({
              component_id: componentIdSchema,
              to_index: z.number().int().min(0),
            }),
            execute: ({ component_id, to_index }) => {
              send("tool_call", {
                toolName: "layoutMove",
                input: { component_id, to_index },
              });
              applyAndEmitPatch(
                makePatch({
                  layout_patch: [{ op: "move", component_id, to_index }],
                })
              );
              return { ok: true };
            },
          }),
          layoutRemove: tool({
            description:
              "Remove a component from the layout (but keep the component stored).",
            inputSchema: z.object({
              component_id: componentIdSchema,
            }),
            execute: ({ component_id }) => {
              send("tool_call", {
                toolName: "layoutRemove",
                input: { component_id },
              });
              applyAndEmitPatch(
                makePatch({
                  layout_patch: [{ op: "remove", component_id }],
                })
              );
              return { ok: true };
            },
          }),
          layoutSet: tool({
            description:
              "Replace the entire layout with an ordered list of component ids.",
            inputSchema: z.object({
              layout: z.array(componentIdSchema).max(200),
            }),
            execute: ({ layout }) => {
              send("tool_call", {
                toolName: "layoutSet",
                input: { layoutCount: layout.length },
              });
              applyAndEmitPatch(
                makePatch({ layout_patch: [{ op: "set", layout }] })
              );
              return { ok: true };
            },
          }),
          finalize: tool({
            description:
              "Call this when the Screen is complete. Provide a short summary for the user.",
            inputSchema: z.object({
              summary: z.string().min(1).max(500),
            }),
            execute: ({ summary }) => {
              send("tool_call", { toolName: "finalize", input: {} });
              finalSummary = summary;
              return { ok: true };
            },
          }),
        };

        const result = await generateText({
          model: anthropic(model),
          system: await getSystemPrompt(),
          prompt: userContext,
          temperature,
          maxOutputTokens: max_tokens,
          tools,
          stopWhen: [hasToolCall("finalize"), stepCountIs(25)],
        });

        const safeSummary =
          finalSummary ??
          (result.text.trim().slice(0, 500) || "Updated screen components.");

        const validated = screenStateSchema.safeParse(currentScreen);
        if (!validated.success) {
          send("error", {
            message: "Final ScreenState failed validation",
            details: validated.error.flatten(),
          });
          controller.close();
          return;
        }

        send("final", { summary: safeSummary, screen: validated.data });
        controller.close();
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : String(err),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
