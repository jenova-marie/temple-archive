/**
 * Regression test: tool inputSchemas must not use Zod `.default(...)`.
 *
 * Why: when an LLM streams tool args without an optional field, Zod
 * validation injects the default during parse. The Vercel AI SDK then
 * emits the validated/defaulted args, which is no longer a strict
 * append-extension of the streamed token sequence.
 *
 * assistant-ui's chat runtime enforces an append-only `argsText` rule
 * and throws "Tool call argsText can only be appended, not updated" —
 * which crashes the chat tree and (transitively) audio/VAD subsystems.
 *
 * Fix pattern: declare the field `.optional()` on the schema and
 * resolve the default inside `execute` via `value ?? DEFAULT`. The
 * description string carries the default for the model to see.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// Pull every tool the package surfaces. Adding a new tool requires
// listing it here so the schema sweep covers it.
import { logMood } from "../src/definitions.js";
import {
  searchMemories,
  listMemories,
  rememberThis,
  forgetThis,
} from "../src/mem0Tools.js";
import { searchKnowledge } from "../src/ragTools.js";
import {
  recallMemory,
  searchEntities,
  getRelatedEntities,
  saveNote,
  logObservation,
  updateEntity,
  deleteEntity,
  createRelationship,
  clearMemoryCache,
} from "../src/memoryTools.js";
import {
  refreshSystemPrompt,
  clearConversation,
} from "../src/systemPromptTools.js";

// `inputSchema` is typed as the AI SDK's FlexibleSchema, but at runtime our
// tools always pass a real Zod schema. We accept `unknown` here and rely
// on the runtime `instanceof` checks in `findDefaultFields` to do the work.
interface ToolLike {
  inputSchema?: unknown;
}

const ALL_TOOLS: Record<string, ToolLike> = {
  logMood,
  searchMemories,
  listMemories,
  rememberThis,
  forgetThis,
  searchKnowledge,
  recallMemory,
  searchEntities,
  getRelatedEntities,
  saveNote,
  logObservation,
  updateEntity,
  deleteEntity,
  createRelationship,
  clearMemoryCache,
  refreshSystemPrompt,
  clearConversation,
};

/**
 * Walk a Zod schema and return dotted paths of every field whose
 * effective type is `ZodDefault`. Descends into ZodObject shapes and
 * unwraps ZodOptional layers so nested defaults are found too.
 */
function findDefaultFields(schema: unknown, path: string[] = []): string[] {
  // ZodDefault — the thing we're forbidding.
  if (schema instanceof z.ZodDefault) {
    return [path.join(".") || "<root>"];
  }

  // Unwrap ZodOptional / ZodNullable layers and continue.
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    const inner =
      (schema as { unwrap?: () => unknown }).unwrap?.() ??
      (schema as { def?: { innerType?: unknown } }).def?.innerType;
    return inner ? findDefaultFields(inner, path) : [];
  }

  // Walk object shapes.
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, unknown>;
    return Object.entries(shape).flatMap(([key, child]) =>
      findDefaultFields(child, [...path, key]),
    );
  }

  // Walk array element types.
  if (schema instanceof z.ZodArray) {
    const element = (schema as { element?: unknown }).element;
    return element ? findDefaultFields(element, [...path, "[]"]) : [];
  }

  return [];
}

describe("tool input schemas (regression: no Zod .default())", () => {
  for (const [toolName, tool] of Object.entries(ALL_TOOLS)) {
    it(`${toolName} has no .default() in its inputSchema`, () => {
      const schema = tool.inputSchema;
      // Tools without an inputSchema (e.g. zero-arg) trivially pass.
      if (!schema) return;

      const offenders = findDefaultFields(schema);
      expect(offenders, offenders.length > 0
        ? `Tool '${toolName}' inputSchema has Zod .default() on field(s): ${offenders.join(", ")}.\n` +
          `Move the default into execute() (e.g. \`value ?? DEFAULT\`) and use .optional() on the schema.\n` +
          `See: assistant-ui rejects mid-stream argsText reshuffling caused by Zod default injection.`
        : "ok").toEqual([]);
    });
  }

  it("findDefaultFields detects defaults at the top level", () => {
    const schema = z.object({
      a: z.string(),
      b: z.number().default(42),
    });
    expect(findDefaultFields(schema)).toEqual(["b"]);
  });

  it("findDefaultFields detects defaults wrapped in optional", () => {
    const schema = z.object({
      a: z.string().optional().default("x"),
    });
    expect(findDefaultFields(schema).length).toBeGreaterThan(0);
  });

  it("findDefaultFields ignores plain optional() fields", () => {
    const schema = z.object({
      a: z.string().optional(),
      b: z.number().optional(),
    });
    expect(findDefaultFields(schema)).toEqual([]);
  });

  it("findDefaultFields descends into nested objects", () => {
    const schema = z.object({
      outer: z.object({
        inner: z.string().default("oops"),
      }),
    });
    expect(findDefaultFields(schema)).toEqual(["outer.inner"]);
  });
});
