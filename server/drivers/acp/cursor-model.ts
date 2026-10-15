interface CursorParameter {
  id: string;
  name: string;
  currentValue: string;
  options: Array<{ value: string; name?: string }>;
}

export interface CursorParameterizedModel {
  value: string;
  name: string;
  configOptions?: CursorParameter[];
}

const normalized = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (value: string): string[] => value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const isBoolean = (option: CursorParameter): boolean => option.id === "fast"
  || option.options.some((entry) => entry.value === "false") && option.options.some((entry) => entry.value === "true");

export function cursorModelSelection(models: CursorParameterizedModel[], wanted: string, label = wanted) {
  const identity = words(label.replace(/\([^)]*\)/g, ""));
  const candidates = models.flatMap((model) => [model.name, model.value].flatMap((name) => {
    const prefix = words(name);
    return prefix.length && prefix.every((word, index) => word === identity[index]) ? [{ model, prefix }] : [];
  })).sort((a, b) => b.prefix.length - a.prefix.length);
  const selected = candidates[0];
  if (!selected || candidates.some((entry) => entry.prefix.length === selected.prefix.length && entry.model.value !== selected.model.value)) {
    throw new Error(`Cursor does not offer an unambiguous model for "${wanted}". Refresh models and choose a listed model.`);
  }
  const options = selected.model.configOptions ?? [];
  const parameters = new Map(options.map((option) => [option.id,
    isBoolean(option) ? "false" : option.currentValue]));
  const aliases = options.flatMap((option) => {
    return isBoolean(option)
      ? [option.id, option.name].flatMap((name) => [
          { token: normalized(name), id: option.id, value: "true" },
          { token: `no${normalized(name)}`, id: option.id, value: "false" },
        ])
      : option.options.flatMap((entry) => [entry.value, entry.name].flatMap((name) =>
          name ? [{ token: normalized(name), id: option.id, value: entry.value }] : []));
  }).filter((entry) => entry.token).sort((a, b) => b.token.length - a.token.length);
  let suffix = identity.slice(selected.prefix.length).join("");
  const applied = new Set<string>();
  while (suffix) {
    const matching = aliases.filter((entry) => !applied.has(entry.id) && suffix.startsWith(entry.token));
    const match = matching[0];
    if (!match || matching.some((entry) => entry.token.length === match.token.length && (entry.id !== match.id || entry.value !== match.value))) {
      throw new Error(`Cursor does not offer the requested parameters for "${wanted}".`);
    }
    parameters.set(match.id, match.value);
    applied.add(match.id);
    suffix = suffix.slice(match.token.length);
  }
  return { modelId: selected.model.value, parameters: [...parameters].map(([configId, value]) => ({ configId, value })) };
}

type Request = (method: string, params: unknown) => Promise<unknown>;

/** Cursor Agent 2026.10.14 exposes parameter definitions through cursor/list_available_models;
 * parameterizedModelPicker must be negotiated in initialize before setting individual options. */
export async function configureCursorModel(request: Request, sessionId: string, wanted: string, label?: string): Promise<void> {
  const catalog = await request("cursor/list_available_models", {}) as { models: CursorParameterizedModel[] };
  const { modelId, parameters } = cursorModelSelection(catalog.models, wanted, label);
  await request("session/set_config_option", { sessionId, configId: "model", value: modelId });
  for (const parameter of parameters) await request("session/set_config_option", { sessionId, ...parameter });
}
