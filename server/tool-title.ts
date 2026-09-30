import type { WireMessage } from "../shared/wire.ts";

// Provider tool titles are display metadata, not executable input. Some ACP
// providers put an entire inline image/command in the title; sending that to
// every browser makes even a short transcript take megabytes to open.
export const TOOL_TITLE_MAX_CHARS = 2_048;
const SHORTENED_SUFFIX = "… [tool title shortened]";

export function boundedToolTitle(title: string): string {
  if (title.length <= TOOL_TITLE_MAX_CHARS) return title;
  const length = TOOL_TITLE_MAX_CHARS - SHORTENED_SUFFIX.length;
  const prefix = title.slice(0, length);
  const last = prefix.charCodeAt(prefix.length - 1);
  return `${last >= 0xd800 && last <= 0xdbff ? prefix.slice(0, -1) : prefix}${SHORTENED_SUFFIX}`;
}

/** Project older oversized records without rewriting their stored history. */
export function publicTranscriptMessage(message: WireMessage): WireMessage {
  if (!message.tool) return message;
  const name = boundedToolTitle(message.tool.name);
  return name === message.tool.name ? message : { ...message, tool: { ...message.tool, name } };
}
