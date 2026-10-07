import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ report: null as unknown }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [initial === null ? fixture.report : initial === true ? false : typeof initial === "function" ? (initial as () => unknown)() : initial, () => {}],
}));
vi.mock("@/state/store", () => ({ api: vi.fn() }));
import { PlanUsage } from "./PlanUsage";

describe("Plan usage presentation", () => {
  it("distinguishes remaining account allowance, per-model usage, and unavailable windows", () => {
    fixture.report = {
      fetchedAt: "2026-10-02T09:00:00Z",
      providers: [{
        id: "fixture", name: "Fixture provider", driver: "claude", plan: "Pro", ok: true, error: null,
        fiveHour: { available: true, remainingPercent: 68, usedPercent: 32, resetsAt: null },
        weekly: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null }, extra: [],
        models: [{ name: "Sonnet", windows: [{ label: "Weekly", remainingPercent: 30, usedPercent: 70, resetsAt: null }] }],
      }],
    };
    const html = renderToStaticMarkup(createElement(PlanUsage));
    expect(html).toContain("68% left");
    expect(html).toContain("70% used");
    expect(html).toContain("Not reported by this plan");
    expect(html).not.toContain("100% left");
    expect(html).toContain('aria-valuenow="32"');
    expect(html).toContain('aria-valuenow="70"');
  });

  it("shows an account error without inventing zero usage", () => {
    fixture.report = { providers: [{ id: "fixture", name: "Fixture provider", ok: false, error: "Sign in to this account." }] };
    const html = renderToStaticMarkup(createElement(PlanUsage));
    expect(html).toContain("Sign in to this account.");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("100% left");
  });

  it("shows Cursor's monthly allowance and pool remainders without irrelevant windows", () => {
    const unavailable = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
    fixture.report = { providers: [{ id: "cursor", name: "Cursor", driver: "cursor", plan: "Pro", ok: true, error: null,
      fiveHour: unavailable, weekly: unavailable,
      extra: [{ label: "Monthly", remainingPercent: 53, usedPercent: 47, resetsAt: null }],
      models: [
        { name: "Cursor Models", windows: [{ label: "Monthly", remainingPercent: 51, usedPercent: 49, resetsAt: null }] },
        { name: "Other Models", windows: [{ label: "Monthly", remainingPercent: 100, usedPercent: 0, resetsAt: null }] },
      ],
    }] };
    const html = renderToStaticMarkup(createElement(PlanUsage));
    expect(html).toContain("53% left");
    expect(html).toContain("51% left");
    expect(html).toContain("100% left");
    expect(html).toContain("Monthly");
    expect(html).toContain("By model pool");
    expect(html).toContain('aria-label="Cursor models Monthly"');
    expect(html).not.toContain("49% used");
    expect(html).not.toContain("Not reported by this plan");
    expect(html).not.toContain("5-hour");
    expect(html).not.toContain("Weekly");
  });

  it("does not show an untouched Cursor allowance when usage is unavailable", () => {
    const unavailable = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
    fixture.report = { providers: [{ id: "cursor", name: "Cursor", driver: "cursor", ok: true,
      fiveHour: unavailable, weekly: unavailable, extra: [], models: [],
    }] };
    const html = renderToStaticMarkup(createElement(PlanUsage));
    expect(html).toContain("Not reported by this plan");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("100% left");
  });

  it("shows Antigravity's remaining quota by pool without inventing a shared total", () => {
    const unavailable = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
    fixture.report = { providers: [{ id: "antigravity", name: "Antigravity", driver: "antigravity", plan: "Google AI Pro", ok: true,
      fiveHour: unavailable, weekly: unavailable, extra: [],
      models: [{ name: "Gemini Models", windows: [
        { label: "5-hour", remainingPercent: 60, usedPercent: 40, resetsAt: null },
        { label: "Weekly", remainingPercent: 80, usedPercent: 20, resetsAt: null },
      ] }],
    }] };
    const html = renderToStaticMarkup(createElement(PlanUsage));
    expect(html).toContain("Google AI Pro");
    expect(html).toContain("60% left");
    expect(html).toContain("80% left");
    expect(html).toContain('aria-label="Gemini Models 5-hour"');
    expect(html.match(/role="meter"/g)).toHaveLength(2);
    expect(html).not.toContain("Not reported by this plan");
    expect(html).not.toContain("40% used");
  });
});
