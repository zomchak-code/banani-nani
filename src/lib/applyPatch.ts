import type { Patch, ScreenState } from "@/lib/screenSchema";

function uniqKeepOrder(ids: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function clampIndex(index: number, length: number) {
  if (Number.isNaN(index) || !Number.isFinite(index)) {
    return length;
  }
  return Math.max(0, Math.min(index, length));
}

function removeAll(layout: string[], componentId: string) {
  return layout.filter((id) => id !== componentId);
}

function normalizeLayout(next: ScreenState): ScreenState {
  return {
    ...next,
    layout: uniqKeepOrder(next.layout)
      .filter((id) => Boolean(next.components[id]))
      .slice(0, 200),
  };
}

function applyUpserts(
  next: ScreenState,
  patch: Patch,
  prevComponentIds: ReadonlySet<string>
) {
  const newlyAddedComponentIds = new Set<string>();
  for (const comp of patch.upsert_components ?? []) {
    next.components[comp.id] = { name: comp.name, html: comp.html };
    if (!prevComponentIds.has(comp.id)) {
      newlyAddedComponentIds.add(comp.id);
    }
  }
  return newlyAddedComponentIds;
}

function applyDeletes(next: ScreenState, patch: Patch) {
  for (const id of patch.delete_components ?? []) {
    delete next.components[id];
    next.layout = removeAll(next.layout, id);
  }
}

function applyLayoutOps(next: ScreenState, patch: Patch) {
  for (const op of patch.layout_patch ?? []) {
    switch (op.op) {
      case "set": {
        next.layout = op.layout.filter((id) => Boolean(next.components[id]));
        break;
      }
      case "remove": {
        next.layout = removeAll(next.layout, op.component_id);
        break;
      }
      case "insert": {
        const id = op.component_id;
        if (!next.components[id]) {
          break;
        }
        next.layout = removeAll(next.layout, id);
        const idx = clampIndex(op.index, next.layout.length);
        next.layout.splice(idx, 0, id);
        break;
      }
      case "move": {
        const id = op.component_id;
        if (!next.components[id]) {
          break;
        }
        if (!next.layout.includes(id)) {
          break;
        }
        next.layout = removeAll(next.layout, id);
        const idx = clampIndex(op.to_index, next.layout.length);
        next.layout.splice(idx, 0, id);
        break;
      }
      default: {
        // Should be unreachable due to schema validation, but keep a default
        // branch for defensive programming / linter satisfaction.
        break;
      }
    }
  }
}

function appendNewComponentsToLayout(
  next: ScreenState,
  newlyAddedIds: Set<string>
) {
  if (newlyAddedIds.size === 0) {
    return;
  }

  for (const id of newlyAddedIds) {
    if (!next.components[id]) {
      continue;
    }
    if (next.layout.includes(id)) {
      continue;
    }
    next.layout.push(id);
  }
}

export function applyPatch(prev: ScreenState, patch: Patch): ScreenState {
  const prevComponentIds = new Set(Object.keys(prev.components));
  const next: ScreenState = {
    title: patch.title ?? prev.title,
    globalCss: patch.globalCss ?? prev.globalCss,
    components: { ...prev.components },
    layout: [...prev.layout],
  };

  const newlyAddedComponentIds = applyUpserts(next, patch, prevComponentIds);
  applyDeletes(next, patch);
  applyLayoutOps(next, patch);

  // UX safety net: if the model created new components but forgot to insert them
  // into the layout, append them so they show up in the preview by default.
  appendNewComponentsToLayout(next, newlyAddedComponentIds);
  return normalizeLayout(next);
}
