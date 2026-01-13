"use client";

import { RefreshCcw } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { applyPatch } from "@/lib/applyPatch";
import { renderScreenSrcDoc } from "@/lib/renderScreen";
import {
  patchSchema,
  type ScreenState,
  screenStateSchema,
} from "@/lib/screenSchema";
import { cn } from "@/lib/utils";
import bananiLogo from "./banani.png";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const emptyScreen: ScreenState = { components: {}, layout: [] };

interface SseEvent {
  event: string;
  data: string;
}

function makeId() {
  const maybe = globalThis.crypto?.randomUUID?.();
  if (maybe) {
    return maybe;
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseSseEvents(buffer: string): { events: SseEvent[]; rest: string } {
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? "";
  const events: SseEvent[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    let event = "message";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    events.push({ event, data: dataLines.join("\n") });
  }

  return { events, rest };
}

function handleGenerateSseEvent(
  evt: SseEvent,
  handlers: {
    onPatch: (patch: unknown) => void;
    onFinal: (final: { summary: string; screen: ScreenState }) => void;
  }
) {
  if (!evt.data) {
    return;
  }

  switch (evt.event) {
    case "patch": {
      const obj = JSON.parse(evt.data) as { patch?: unknown };
      handlers.onPatch(obj.patch);
      break;
    }
    case "final": {
      const obj = JSON.parse(evt.data) as {
        summary?: unknown;
        screen?: unknown;
      };
      const finalScreen = screenStateSchema.parse(obj.screen);
      const summary =
        typeof obj.summary === "string" && obj.summary.trim()
          ? obj.summary.trim()
          : "Updated screen components.";
      handlers.onFinal({ summary, screen: finalScreen });
      break;
    }
    case "error": {
      const obj = JSON.parse(evt.data) as { message?: unknown };
      const message =
        typeof obj.message === "string" && obj.message.trim()
          ? obj.message.trim()
          : "Unknown error";
      throw new Error(message);
    }
    default: {
      break;
    }
  }
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [screen, setScreen] = useState<ScreenState | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!screen) {
      return;
    }
    if (selectedComponentId && screen.components[selectedComponentId]) {
      return;
    }
    const next = screen.layout[0] ?? Object.keys(screen.components)[0] ?? null;
    setSelectedComponentId(next);
  }, [screen, selectedComponentId]);

  const srcDoc = useMemo(() => renderScreenSrcDoc(screen), [screen]);

  const layoutIds = screen?.layout ?? [];
  const componentIds = useMemo(() => {
    const ids = Object.keys(screen?.components ?? {});
    ids.sort();
    return ids;
  }, [screen]);

  const selected = selectedComponentId
    ? screen?.components[selectedComponentId]
    : null;

  const reset = () => {
    setPrompt("");
    setMessages([]);
    setScreen(null);
    setSelectedComponentId(null);
    setLoading(false);
    setError(null);
  };

  async function consumeGenerateStream(
    res: Response,
    handlers: {
      onPatch: (patch: unknown) => void;
      onFinal: (final: { summary: string; screen: ScreenState }) => void;
    }
  ) {
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("Missing response body stream");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const parsed = parseSseEvents(buffer);
      buffer = parsed.rest;

      for (const evt of parsed.events) {
        handleGenerateSseEvent(evt, handlers);
      }
    }
  }

  async function onSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed || loading) {
      return;
    }

    setLoading(true);
    setError(null);

    const nextMessages: ChatMessage[] = [
      ...messages,
      { id: makeId(), role: "user", content: trimmed },
    ];
    setMessages(nextMessages);
    setPrompt("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          screen: screen ?? undefined,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `API error (${res.status}): ${text || "unknown error"}`
        );
      }

      await consumeGenerateStream(res, {
        onPatch: (rawPatch) => {
          const patch = patchSchema.parse(rawPatch);
          setScreen((prev) => applyPatch(prev ?? emptyScreen, patch));
        },
        onFinal: ({ summary, screen: finalScreen }) => {
          setScreen(finalScreen);
          setMessages((prev) => [
            ...prev,
            { id: makeId(), role: "assistant", content: summary },
          ]);
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: "assistant", content: `Error: ${message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <div className="shrink-0 border-b">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-card">
              <Image
                alt="Banani"
                className="size-6"
                priority
                src={bananiLogo}
              />
            </div>
            <div className="leading-tight">
              <div className="font-semibold text-sm">Banani... NANIII?</div>
              <div className="text-muted-foreground text-xs">
                Omae wa mou shindeiru
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={reset} size="sm" variant="outline">
              <RefreshCcw className="size-4" />
              Reset
            </Button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="grid h-full min-h-0 w-full grid-cols-1 gap-4 p-4 lg:grid-cols-[360px_1fr_360px]">
          <Card className="h-full overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Prompt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                className="min-h-[120px]"
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    onSubmit();
                  }
                }}
                placeholder='e.g. "E-commerce product page for sneakers"'
                value={prompt}
              />
              <div className="flex items-center justify-between gap-2">
                <div className="text-muted-foreground text-xs">
                  Send: Ctrl/⌘ + Enter
                </div>
                <Button disabled={loading || !prompt.trim()} onClick={onSubmit}>
                  Generate
                </Button>
              </div>
              {error ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-xs">
                  {error}
                </div>
              ) : null}
              <Separator />
              <div className="space-y-2">
                <div className="font-medium text-muted-foreground text-xs">
                  Session
                </div>
                <ScrollArea
                  className="rounded-md border bg-muted/20"
                  maxHeightClassName="max-h-[320px] lg:max-h-[420px]"
                >
                  <div className="space-y-2 p-3">
                    {messages.length === 0 ? (
                      <div className="text-muted-foreground text-xs">
                        No messages yet.
                      </div>
                    ) : (
                      messages.map((m) => (
                        <div className="space-y-1" key={m.id}>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            {m.role}
                          </div>
                          <div className="text-sm leading-5">{m.content}</div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>

          <Card className="h-full overflow-hidden">
            <CardContent className="relative h-full bg-white p-0">
              {loading ? (
                <div className="absolute inset-0 z-10 grid place-items-center bg-background/70 backdrop-blur-sm">
                  <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
                    <RefreshCcw className="size-5 animate-spin" />
                    <div className="font-medium">Generating…</div>
                  </div>
                </div>
              ) : null}
              <iframe
                className="h-full w-full"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts"
                srcDoc={srcDoc}
                title="Generated screen"
              />
            </CardContent>
          </Card>

          <Card className="flex h-full flex-col overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Components</CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <ScrollArea
                className="shrink-0 rounded-md border"
                maxHeightClassName="max-h-[260px] lg:max-h-[340px]"
              >
                <div className="p-2">
                  {screen && componentIds.length > 0 ? (
                    <div className="space-y-1">
                      {componentIds.map((id) => {
                        const inLayout = layoutIds.includes(id);
                        const isSelected = id === selectedComponentId;
                        const name = screen.components[id]?.name ?? id;
                        return (
                          <button
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                              isSelected && "bg-accent"
                            )}
                            key={id}
                            onClick={() => setSelectedComponentId(id)}
                            type="button"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium">{name}</div>
                              <div className="truncate text-muted-foreground text-xs">
                                {id}
                              </div>
                            </div>
                            {inLayout ? (
                              <Badge variant="secondary">in layout</Badge>
                            ) : (
                              <Badge variant="outline">unused</Badge>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-2 text-muted-foreground text-sm">
                      Generate a screen to see components.
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-muted-foreground text-xs">
                    Selected component
                  </div>
                  {selectedComponentId ? (
                    <Badge variant="outline">{selectedComponentId}</Badge>
                  ) : null}
                </div>
                <div className="min-h-0 flex-1 rounded-md border bg-muted/20">
                  <pre className="wrap-break-word h-full overflow-auto whitespace-pre-wrap p-3 text-xs leading-5">
                    {selected
                      ? selected.html
                      : "Select a component to view its HTML."}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
