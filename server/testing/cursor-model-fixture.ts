import type { CursorParameterizedModel } from "../drivers/acp/cursor-model.ts";

export const CURSOR_MODEL_FIXTURE: CursorParameterizedModel[] = [
  { value: "default", name: "Auto" },
  { value: "grok-4.7", name: "Grok 4.7", configOptions: [
    { id: "context", name: "Context", currentValue: "256k", options: [{ value: "256k", name: "256K" }, { value: "500k", name: "500K" }] },
    { id: "reasoning_effort", name: "Effort", currentValue: "high", options: ["low", "medium", "high", "xhigh"].map((value) => ({ value, name: value === "xhigh" ? "Extra High" : value })) },
    { id: "fast", name: "Fast", currentValue: "true", options: [{ value: "false" }, { value: "true" }] },
  ] },
  { value: "gpt-5.3-codex", name: "Codex 5.3", configOptions: [
    { id: "reasoning", name: "Reasoning", currentValue: "medium", options: [
      { value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" },
      { value: "extra-high", name: "Extra High" },
    ] },
    { id: "fast", name: "Fast", currentValue: "false", options: [{ value: "false" }, { value: "true" }] },
  ] },
  { value: "composer-2.5", name: "Composer 2.5", configOptions: [
    { id: "fast", name: "Fast", currentValue: "true", options: [{ value: "false" }, { value: "true" }] },
  ] },
];
