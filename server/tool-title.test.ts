import { describe, expect, it } from "vitest";
import { boundedToolTitle, publicTranscriptMessage, TOOL_TITLE_MAX_CHARS } from "./tool-title.ts";
import type { WireMessage } from "../shared/wire.ts";
import { slimMessage } from "./host/message-pages.ts";

describe("tool titles on the transcript wire", () => {
  it("keeps ordinary titles and bounds an older oversized title without changing history", () => {
    expect(boundedToolTitle("Bash: echo hello")).toBe("Bash: echo hello");
    const original: WireMessage = {
      id: "old-tool", at: 1, role: "bot", kind: "activity",
      tool: { name: `Bash: python -c ${"x".repeat(6_000)}`, input: "short preview", ok: true },
    };
    const projected = publicTranscriptMessage(original);
    expect(projected.tool?.name.length).toBeLessThanOrEqual(TOOL_TITLE_MAX_CHARS);
    expect(projected.tool?.name).toContain("[tool title shortened]");
    expect(projected.tool?.input).toBe("short preview");
    expect(original.tool?.name.length).toBeGreaterThan(TOOL_TITLE_MAX_CHARS);
  });

  it("does not leave half of a Unicode surrogate pair on the wire", () => {
    const title = `${"a".repeat(TOOL_TITLE_MAX_CHARS)}🌱`;
    const bounded = boundedToolTitle(title);
    expect(bounded.length).toBeLessThanOrEqual(TOOL_TITLE_MAX_CHARS);
    expect(Buffer.from(bounded).toString()).toBe(bounded);
    expect(/[\uD800-\uDBFF]$/.test(bounded)).toBe(false);
  });

  it("projects paginated and live messages without oversized titles or inline screen pixels", () => {
    const original: WireMessage = {
      id: "screen-tool", at: 1, role: "bot", kind: "screen", png: "inline-pixels",
      tool: { name: "x".repeat(6_000), input: "short preview" },
    };
    const projected = slimMessage(original);
    expect(projected).toMatchObject({ hasImage: true, tool: { input: "short preview" } });
    expect(projected).not.toHaveProperty("png");
    expect((projected as WireMessage).tool?.name.length).toBeLessThanOrEqual(TOOL_TITLE_MAX_CHARS);
    expect(original.png).toBe("inline-pixels");
    expect(original.tool?.name).toHaveLength(6_000);
  });
});
