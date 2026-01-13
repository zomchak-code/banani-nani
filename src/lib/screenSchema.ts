import { z } from "zod";

export const componentIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-_]*$/);

export const screenComponentSchema = z.object({
  id: componentIdSchema,
  name: z.string().min(1).max(80),
  html: z.string().min(1).max(50_000),
});

export const storedComponentSchema = z.object({
  name: z.string().min(1).max(80),
  html: z.string().min(1).max(50_000),
});

export const screenStateSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    globalCss: z.string().max(20_000).optional(),
    components: z.record(z.string(), storedComponentSchema),
    layout: z.array(componentIdSchema).max(200),
  })
  .superRefine((val, ctx) => {
    for (const key of Object.keys(val.components)) {
      const parsed = componentIdSchema.safeParse(key);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid component id key: ${key}`,
          path: ["components", key],
        });
      }
    }
  });

export const layoutPatchOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("insert"),
    component_id: componentIdSchema,
    index: z.number().int().min(0),
  }),
  z.object({
    op: z.literal("remove"),
    component_id: componentIdSchema,
  }),
  z.object({
    op: z.literal("move"),
    component_id: componentIdSchema,
    to_index: z.number().int().min(0),
  }),
  z.object({
    op: z.literal("set"),
    layout: z.array(componentIdSchema).max(200),
  }),
]);

export const patchSchema = z.object({
  upsert_components: z.array(screenComponentSchema).max(50).default([]),
  delete_components: z.array(componentIdSchema).max(50).default([]),
  layout_patch: z.array(layoutPatchOpSchema).max(200).default([]),
  title: z.string().min(1).max(120).optional(),
  globalCss: z.string().max(20_000).optional(),
});

export const agentResponseSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("regenerate"),
    summary: z.string().min(1).max(500),
    screen: screenStateSchema,
  }),
  z.object({
    action: z.literal("patch"),
    summary: z.string().min(1).max(500),
    patch: patchSchema,
  }),
]);

export type ScreenState = z.infer<typeof screenStateSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export type Patch = z.infer<typeof patchSchema>;
export type LayoutPatchOp = z.infer<typeof layoutPatchOpSchema>;
