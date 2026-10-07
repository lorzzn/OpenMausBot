import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamDeltaBuffer, createStreamStore } from "./streaming";

describe("stream delta flushing", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const prepare = () => {
    vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const flushed = vi.fn();
    return { buffer: createStreamDeltaBuffer(flushed), frames, flushed };
  };

  it("drains a paused animation frame on the timer without duplication", () => {
    const { buffer, frames, flushed } = prepare();
    buffer.push("a", "assistant_text", "hello");
    buffer.push("a", "assistant_text", " world");
    buffer.push("b", "reasoning_text", "thinking");
    expect(flushed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(flushed).toHaveBeenCalledExactlyOnceWith([
      ["a", { text: "hello world", reasoning: "" }], ["b", { text: "", reasoning: "thinking" }],
    ]);
    expect(frames.size).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(flushed).toHaveBeenCalledTimes(1);
  });

  it("flushes oversized chunks in full even when timers and frames are paused", () => {
    const { buffer, flushed } = prepare();
    const text = "🙂".repeat(40_000);
    buffer.push("a", "assistant_text", text);
    expect(flushed).toHaveBeenCalledExactlyOnceWith([["a", { text, reasoning: "" }]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears only the settled task and cancels pending work on disposal", () => {
    const { buffer, frames, flushed } = prepare();
    buffer.push("a", "assistant_text", "already in transcript");
    buffer.push("b", "assistant_text", "still streaming");
    buffer.clear("a");
    frames.values().next().value!(0);
    expect(flushed).toHaveBeenCalledExactlyOnceWith([["b", { text: "still streaming", reasoning: "" }]]);
    buffer.push("b", "reasoning_text", "unmounted");
    buffer.dispose();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(flushed).toHaveBeenCalledTimes(1);
  });
});

describe("thread streaming subscriptions", () => {
  it("keeps the open thread's snapshot and subscribers unchanged during a background reply", () => {
    const store = createStreamStore();
    store.append([["open", { text: "visible", reasoning: "" }]]);
    const snapshot = store.getSnapshot("open");
    const open = vi.fn();
    const background = vi.fn();
    const all = vi.fn();
    store.subscribe("open", open);
    store.subscribe("background", background);
    store.subscribe(undefined, all);
    store.append([["background", { text: "offscreen", reasoning: "thinking" }]]);
    expect(store.getSnapshot("open")).toBe(snapshot);
    expect(open).not.toHaveBeenCalled();
    expect(background).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot("background")).toEqual({
      streaming: { background: "offscreen" }, reasoning: { background: "thinking" },
    });
    expect(store.getSnapshot("background")).toBe(store.getSnapshot("background"));
    store.append([["open", { text: " reply", reasoning: "" }]]);
    expect(store.getSnapshot("open").streaming.open).toBe("visible reply");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("settles one thread without losing another and resets both live channels on resync", () => {
    const store = createStreamStore();
    const notify = vi.fn();
    store.subscribe("a", notify);
    store.append([
      ["a", { text: "done", reasoning: "thought" }],
      ["b", { text: "busy", reasoning: "more" }],
    ]);
    store.clear("a");
    expect(store.getSnapshot("a")).toEqual({ streaming: {}, reasoning: {} });
    expect(store.getSnapshot().streaming.b).toBe("busy");
    expect(notify).toHaveBeenCalledTimes(2);
    store.clear("a");
    expect(notify).toHaveBeenCalledTimes(2);
    store.reset();
    expect(store.getSnapshot("b")).toEqual({ streaming: {}, reasoning: {} });
    expect(store.getSnapshot()).toEqual({ streaming: {}, reasoning: {} });
  });

  it("unsubscribes switched chats without leaving listeners active", () => {
    const store = createStreamStore();
    const notify = vi.fn();
    const unsubscribe = store.subscribe("old", notify);
    unsubscribe();
    store.append([["old", { text: "continued", reasoning: "" }]]);
    expect(notify).not.toHaveBeenCalled();
  });
});
