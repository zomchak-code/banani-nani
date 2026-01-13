"use client";

import { RefreshCcw, Sparkles } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { applyPatch } from "@/lib/applyPatch";
import { renderScreenSrcDoc } from "@/lib/renderScreen";
import {
  type AgentResponse,
  agentResponseSchema,
  type ScreenState,
} from "@/lib/screenSchema";
import { cn } from "@/lib/utils";

type ChatMessage = { role: "user" | "assistant"; content: string };

const emptyScreen: ScreenState = { components: {}, layout: [] };

export default function Home() {
  const [prompt, setPrompt] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [screen, setScreen] = React.useState<ScreenState | null>(null);
  const [selectedComponentId, setSelectedComponentId] = React.useState<
    string | null
  >(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!screen) return;
    if (selectedComponentId && screen.components[selectedComponentId]) return;
    const next = screen.layout[0] ?? Object.keys(screen.components)[0] ?? null;
    setSelectedComponentId(next);
  }, [screen, selectedComponentId]);

  const srcDoc = React.useMemo(() => renderScreenSrcDoc(screen), [screen]);

  const layoutIds = screen?.layout ?? [];
  const componentIds = React.useMemo(() => {
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

  async function onSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(nextMessages);
    setPrompt("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          messages: nextMessages,
          screen: screen ?? undefined,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `API error (${res.status}): ${text || "unknown error"}`
        );
      }

      const json = (await res.json()) as unknown;
      const parsed = agentResponseSchema.parse(json) as AgentResponse;

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: parsed.summary },
      ]);

      if (parsed.action === "regenerate") {
        setScreen(parsed.screen);
      } else {
        setScreen((prev) => applyPatch(prev ?? emptyScreen, parsed.patch));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg border bg-card">
              <Sparkles className="size-4" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold text-sm">AI Screen Composer</div>
              <div className="text-muted-foreground text-xs">
                Generate pages from prompts as reusable components
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

      <div className="grid w-full grid-cols-1 gap-4 p-4 lg:grid-cols-[360px_1fr_360px]">
        <Card className="lg:sticky lg:top-4 lg:h-[calc(100vh-5.5rem)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prompt</CardTitle>
            <CardDescription>
              Describe a screen, then iterate with follow-ups.
            </CardDescription>
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
                    messages.map((m, idx) => (
                      <div className="space-y-1" key={idx}>
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

        <Card className="lg:h-[calc(100vh-5.5rem)]">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base">Screen preview</CardTitle>
                <CardDescription>
                  Rendered in a sandboxed iframe (Tailwind CDN available).
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-[520px] lg:h-[calc(100vh-11rem)]">
            <div className="relative h-full overflow-hidden rounded-lg border bg-white">
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
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col lg:sticky lg:top-4 lg:h-[calc(100vh-5.5rem)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Components</CardTitle>
            <CardDescription>
              {screen
                ? `${layoutIds.length} in layout, ${componentIds.length} total`
                : "None yet"}
            </CardDescription>
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
                <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-5">
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
  );
}
