import { expect, it, vi } from "vitest";
import { CURSOR_MODEL_FIXTURE } from "../../testing/cursor-model-fixture.ts";
import { configureCursorModel, cursorModelSelection, type CursorParameterizedModel } from "./cursor-model.ts";

it.each([
  ["grok-4.7-high", "high", "false"],
  ["grok-4.7-high-fast", "high", "true"],
  ["grok-4.7-medium", "medium", "false"],
  ["grok-4.7-xhigh-fast", "xhigh", "true"],
])("keeps the requested effort and Fast switch for %s", (wanted, effort, fast) => {
  expect(cursorModelSelection(CURSOR_MODEL_FIXTURE, wanted)).toEqual({
    modelId: "grok-4.7",
    parameters: [{ configId: "context", value: "256k" }, { configId: "reasoning_effort", value: effort }, { configId: "fast", value: fast }],
  });
});

it("uses CLI display names for legacy slugs and native parameter values", () => {
  expect(cursorModelSelection(CURSOR_MODEL_FIXTURE, "gpt-5.3-codex-xhigh", "Codex 5.3 Extra High")).toEqual({
    modelId: "gpt-5.3-codex", parameters: [{ configId: "reasoning", value: "extra-high" }, { configId: "fast", value: "false" }],
  });
  expect(cursorModelSelection(CURSOR_MODEL_FIXTURE, "auto", "Auto")).toEqual({ modelId: "default", parameters: [] });
});

const future: CursorParameterizedModel = { value: "future-9", name: "Future 9", configOptions: [
  { id: "thinking", name: "Thinking", currentValue: "true", options: [{ value: "false" }, { value: "true" }] },
  { id: "thoughts", name: "Effort", currentValue: "balanced", options: [{ value: "balanced" }, { value: "ultra" }] },
  { id: "fast", name: "Fast", currentValue: "true", options: [{ value: "false" }, { value: "true" }] },
] };

it("reads new model names, effort keys and values from the provider", () => {
  expect(cursorModelSelection([future], "future-9-ultra-thinking-fast")).toEqual({
    modelId: "future-9", parameters: [{ configId: "thinking", value: "true" }, { configId: "thoughts", value: "ultra" }, { configId: "fast", value: "true" }],
  });
  expect(cursorModelSelection([future], "legacy-alias", "Future 9 Ultra No Thinking (NO ZDR)").parameters).toEqual([
    { configId: "thinking", value: "false" }, { configId: "thoughts", value: "ultra" }, { configId: "fast", value: "false" },
  ]);
});

it("refuses unknown parameters, unavailable models and ambiguous names", () => {
  expect(() => cursorModelSelection([future], "future-9-high")).toThrow("requested parameters");
  expect(() => cursorModelSelection([future], "no-such-model")).toThrow("does not offer");
  expect(() => cursorModelSelection([future, { ...future, value: "future.9" }], "future-9")).toThrow("unambiguous");
});

it("does not confuse a 1M context suffix with another model's minor version", () => {
  const base: CursorParameterizedModel = { value: "future-9", name: "Future 9", configOptions: [
    { id: "context", name: "Context", currentValue: "300k", options: [{ value: "300k" }, { value: "1m" }] },
  ] };
  expect(cursorModelSelection([base, { value: "future-9-1", name: "Future 9.1" }], "legacy", "Future 9 1M")).toEqual({
    modelId: "future-9", parameters: [{ configId: "context", value: "1m" }],
  });
});

it("sets the model and parameters without reading back or comparing acknowledgements", async () => {
  const request = vi.fn(async (method: string) => method === "cursor/list_available_models"
    ? { models: CURSOR_MODEL_FIXTURE } : { configOptions: [{ id: "fast", currentValue: "true" }] });
  await configureCursorModel(request, "session-one", "grok-4.7-high");
  expect(request.mock.calls).toEqual([
    ["cursor/list_available_models", {}],
    ["session/set_config_option", { sessionId: "session-one", configId: "model", value: "grok-4.7" }],
    ["session/set_config_option", { sessionId: "session-one", configId: "context", value: "256k" }],
    ["session/set_config_option", { sessionId: "session-one", configId: "reasoning_effort", value: "high" }],
    ["session/set_config_option", { sessionId: "session-one", configId: "fast", value: "false" }],
  ]);
});

it("propagates a rejected setting without choosing another variant or method", async () => {
  const failure = new Error("Fast setting rejected");
  const request = vi.fn(async (method: string, params: unknown) => {
    if (method === "cursor/list_available_models") return { models: CURSOR_MODEL_FIXTURE };
    if ((params as { configId?: string }).configId === "fast") throw failure;
    return {};
  });
  await expect(configureCursorModel(request, "session-one", "grok-4.7-high")).rejects.toBe(failure);
  expect(request).toHaveBeenCalledTimes(5);
});
