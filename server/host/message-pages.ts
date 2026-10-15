import type { Message } from "../store.ts";
import { publicTranscriptMessage } from "../tool-title.ts";

const MESSAGE_PAGE_MAX = 200;

/** undefined = absent, null = present but unusable (the caller answers 400). */
export function pageSize(raw: string | null): number | null | undefined {
  if (raw === null) return undefined;
  const size = Number(raw);
  if (!Number.isInteger(size) || size < 0) return null;
  return Math.min(size, MESSAGE_PAGE_MAX);
}

export function slimMessage(message: Message): Message | Record<string, unknown> {
  const projected = publicTranscriptMessage(message);
  if (projected.kind !== "screen" || !projected.png) return projected;
  const { png: _png, ...rest } = projected;
  return { ...rest, hasImage: true };
}
