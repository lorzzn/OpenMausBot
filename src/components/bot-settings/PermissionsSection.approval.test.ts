import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";

const fixture = vi.hoisted(() => ({ draft: true }));
vi.mock("@/state/store", async importOriginal => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: [], groups: [], sections: [] }, dispatch: vi.fn() }),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("./BotEditorContext", () => ({ useBotEditor: () => ({ draft: fixture.draft }) }));
vi.mock("./ProposalStatus", () => ({ ProposalStatus: () => null }));
vi.mock("../FullAccessWarning", () => ({ FullAccessWarning: () => null }));
vi.mock("../LocalComputerAutoWarning", () => ({ LocalComputerAutoWarning: () => null }));
vi.mock("../ApprovalModeSelector", async importOriginal => {
  const actual = await importOriginal<typeof import("../ApprovalModeSelector")>();
  return {
    ...actual,
    ApprovalModeSelector: (props: Parameters<typeof actual.ApprovalModeSelector>[0]) =>
      createElement("span", {
        "data-approval-options": actual.approvalModeOptionsFor(
          props.driverKind, props.trustedModesAvailable, props.customAvailable,
        ).map(option => option.mode).join(","),
      }),
  };
});

import { PermissionsSection } from "./PermissionsSection";

const bot = {
  id: "draft-bot", name: "Draft", modelSelection: { instanceId: "antigravity", model: "gemini" },
  approvalMode: "ask", computer: "off",
} as Bot;

function renderOptions(trustedModesAvailable: boolean, customAvailable = false) {
  const derived = {
    patch: vi.fn(),
    engine: { displayName: "Antigravity", driverKind: "antigravityAgent" },
    approvalMode: "ask", trustedModesAvailable, customAvailable,
    canCoordinate: false, sectionName: "General",
  } as unknown as ReturnType<typeof useBotSettingsDerived>;
  return renderToStaticMarkup(createElement(PermissionsSection, { bot, derived }));
}

describe("new-bot approval options", () => {
  it("offers Full access in a paired admin browser draft", () => {
    fixture.draft = true;
    expect(renderOptions(true)).toContain('data-approval-options="ask,edits,full"');
  });

  it("keeps Full access hidden without a trusted grant path", () => {
    fixture.draft = true;
    expect(renderOptions(false)).toContain('data-approval-options="ask,edits"');
  });
});
