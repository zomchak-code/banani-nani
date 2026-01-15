"use client";

import { RefreshCcw } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { applyPatch } from "@/lib/applyPatch";
import {
  buildComponentExportPayload,
  buildExportPayload,
  renderComponentSrcDoc,
  renderScreenSrcDoc,
} from "@/lib/renderScreen";
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

function sanitizeFilename(input: string) {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "") || "banani-export";
}

function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
    const components = screen?.components ?? {};
    const layout = screen?.layout ?? [];
    const layoutSet = new Set(layout);
    const remaining = Object.keys(components).filter(
      (id) => !layoutSet.has(id)
    );
    remaining.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return [...layout, ...remaining];
  }, [screen]);

  const selected = selectedComponentId
    ? screen?.components[selectedComponentId]
    : null;

  const selectedSrcDoc = useMemo(
    () => renderComponentSrcDoc(screen, selectedComponentId),
    [screen, selectedComponentId]
  );

  const canExportScreen = Boolean(screen) && !loading;
  const canExportComponent =
    Boolean(screen) && Boolean(selectedComponentId) && !loading;

  const reset = () => {
    setPrompt("");
    setMessages([]);
    setScreen(null);
    setSelectedComponentId(null);
    setLoading(false);
    setError(null);
  };

  const onExportScreen = () => {
    if (!screen) {
      return;
    }
    try {
      const payload = buildExportPayload(screen);
      const title = screen.title ?? "banani-screen";
      const filename = `${sanitizeFilename(title)}.html`;
      downloadTextFile(filename, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      setError(message);
    }
  };

  const onExportComponent = () => {
    if (!(screen && selectedComponentId)) {
      return;
    }
    try {
      const payload = buildComponentExportPayload(screen, selectedComponentId);
      const component =
        screen.components[selectedComponentId]?.name ?? selectedComponentId;
      const filename = `${sanitizeFilename(component)}.html`;
      downloadTextFile(filename, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      setError(message);
    }
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
        <div className="grid min-h-0 flex-1 grid-rows-[1fr_1px_auto] border-t">
          <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[1fr_1px_1fr]">
            <section className="flex min-h-0 flex-col gap-4">
              <div className="px-4 pt-4 font-semibold text-base">
                Components
              </div>
              <div className="px-4">
                <ScrollArea maxHeightClassName="max-h-[360px] lg:max-h-[420px]">
                  <div>
                    {screen && componentIds.length > 0 ? (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {componentIds.map((id) => {
                          const inLayout = layoutIds.includes(id);
                          const isSelected = id === selectedComponentId;
                          const name = screen.components[id]?.name ?? id;
                          return (
                            <button
                              className={cn(
                                "flex h-full w-full flex-col items-start gap-3 rounded-md border bg-background p-3 text-left text-sm transition hover:bg-accent",
                                isSelected && "border-foreground/20 bg-accent"
                              )}
                              key={id}
                              onClick={() => setSelectedComponentId(id)}
                              type="button"
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="truncate font-medium">
                                  {name}
                                </div>
                                <div className="truncate text-muted-foreground text-xs">
                                  {id}
                                </div>
                              </div>
                              {inLayout ? (
                                <Badge className="mt-auto" variant="secondary">
                                  in layout
                                </Badge>
                              ) : (
                                <Badge className="mt-auto" variant="outline">
                                  unused
                                </Badge>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-sm">
                        Generate a screen to see components.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="flex items-center justify-between px-4 text-muted-foreground text-xs">
                  <div>Component preview</div>
                  <Button
                    disabled={!canExportComponent}
                    onClick={onExportComponent}
                    size="sm"
                    title={
                      selectedComponentId
                        ? "Export selected component preview"
                        : "Select a component to export"
                    }
                    variant="outline"
                  >
                    Export preview
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden bg-white">
                  <iframe
                    className="h-full w-full"
                    referrerPolicy="no-referrer"
                    sandbox="allow-scripts"
                    srcDoc={selectedSrcDoc}
                    title={selected ? `Preview ${selected.name}` : "Preview"}
                  />
                </div>
              </div>
            </section>

            <div className="hidden bg-border lg:block" />

            <section className="relative flex min-h-0 flex-col bg-white">
              {loading ? (
                <div className="absolute inset-0 z-10 grid place-items-center bg-background/70 backdrop-blur-sm">
                  <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
                    <RefreshCcw className="size-5 animate-spin" />
                    <div className="font-medium">Generating…</div>
                  </div>
                </div>
              ) : null}
              <div className="flex items-center justify-between px-4 py-2 text-muted-foreground text-xs">
                <div>Screen preview</div>
                <Button
                  disabled={!canExportScreen}
                  onClick={onExportScreen}
                  size="sm"
                  title={
                    screen
                      ? "Export layout and component code"
                      : "Generate a screen to export"
                  }
                  variant="outline"
                >
                  Export layout
                </Button>
              </div>
              <iframe
                className="h-full w-full flex-1"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts"
                srcDoc={srcDoc}
                title="Generated screen"
              />
            </section>
          </div>

          <div className="bg-border" />

          <section className="overflow-visible p-4">
            <div className="font-semibold text-base">Prompt</div>
            <div className="mt-3 space-y-3">
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-muted-foreground text-xs">
                  Send: Ctrl/⌘ + Enter
                </div>
                <div className="flex items-center gap-2">
                  <div className="group relative">
                    <Button size="sm" type="button" variant="ghost">
                      History
                    </Button>
                    <div className="pointer-events-none absolute right-0 bottom-full z-50 w-2xl opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
                      <div className="rounded-lg border bg-card p-3 shadow-lg">
                        <div className="mb-2 text-muted-foreground text-xs">
                          Session history
                        </div>
                        <ScrollArea maxHeightClassName="max-h-64">
                          <div className="space-y-2 pr-2">
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
                                  <div className="text-sm leading-5">
                                    {m.content}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                      </div>
                    </div>
                  </div>
                  <Button
                    disabled={loading || !prompt.trim()}
                    onClick={onSubmit}
                    size="sm"
                  >
                    Generate
                  </Button>
                </div>
              </div>
              {error ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-xs">
                  {error}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
