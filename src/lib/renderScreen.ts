import type { ScreenState } from "@/lib/screenSchema";

function stripScriptsAndHandlers(input: string) {
  let out = input;
  // Remove <script>...</script>
  out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  // Remove inline event handlers like onclick=""
  out = out.replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
  return out;
}

export function renderScreenSrcDoc(screen: ScreenState | null): string {
  const title = screen?.title ?? "Generated Screen";
  const globalCss = screen?.globalCss ?? "";

  const htmlParts: string[] = [];
  if (screen) {
    for (const id of screen.layout) {
      const comp = screen.components[id];
      if (!comp) continue;
      htmlParts.push(stripScriptsAndHandlers(comp.html));
    }
  }

  const bodyInner =
    htmlParts.length > 0
      ? htmlParts.join("\n")
      : `<div class="min-h-[50vh] flex items-center justify-center text-zinc-500">
           <div class="text-center space-y-2">
             <div class="text-sm font-medium">No screen yet</div>
             <div class="text-xs">Describe a page in the prompt box to generate one.</div>
           </div>
         </div>`;

  const safeGlobalCss = stripScriptsAndHandlers(globalCss);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      :root { color-scheme: light; }
      html, body { height: 100%; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
      ${safeGlobalCss}
    </style>
  </head>
  <body>
    <div class="min-h-screen bg-zinc-50 text-zinc-900">
      ${bodyInner}
    </div>
  </body>
</html>`;
}

export function renderComponentSrcDoc(
  screen: ScreenState | null,
  componentId: string | null
): string {
  const title = componentId ? `Component: ${componentId}` : "Component Preview";
  const globalCss = screen?.globalCss ?? "";
  const comp = componentId ? screen?.components[componentId] : null;
  const bodyInner = comp
    ? stripScriptsAndHandlers(comp.html)
    : `<div class="min-h-[40vh] flex items-center justify-center text-zinc-500">
         <div class="text-center space-y-2">
           <div class="text-sm font-medium">No component selected</div>
           <div class="text-xs">Pick a component to preview it here.</div>
         </div>
       </div>`;
  const safeGlobalCss = stripScriptsAndHandlers(globalCss);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      :root { color-scheme: light; }
      html, body { height: 100%; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
      ${safeGlobalCss}
    </style>
  </head>
  <body>
    <div class="min-h-screen bg-white text-zinc-900">
      ${bodyInner}
    </div>
  </body>
</html>`;
}
