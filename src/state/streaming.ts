export interface StreamState {
  streaming: Record<string, string>;
  reasoning: Record<string, string>;
}

const EMPTY_STREAM: StreamState = { streaming: {}, reasoning: {} };
export type PendingDelta = { text: string; reasoning: string };

/** Keep live text outside the app reducer. Only subscribers to the changed
 * thread are notified, so a background reply never redraws the open chat. */
export function createStreamStore() {
  let snapshot = EMPTY_STREAM;
  const selected = new Map<string, StreamState>();
  const listeners = new Map<string | undefined, Set<() => void>>();
  const notify = (threads: readonly string[]) => {
    for (const threadId of threads) {
      selected.delete(threadId);
      for (const listener of listeners.get(threadId) ?? []) listener();
    }
    for (const listener of listeners.get(undefined) ?? []) listener();
  };
  return {
    getSnapshot(threadId?: string): StreamState {
      if (threadId === undefined) return snapshot;
      const cached = selected.get(threadId);
      if (cached) return cached;
      const text = snapshot.streaming[threadId];
      const reasoning = snapshot.reasoning[threadId];
      const view = text || reasoning ? {
        streaming: text ? { [threadId]: text } : {},
        reasoning: reasoning ? { [threadId]: reasoning } : {},
      } : EMPTY_STREAM;
      selected.set(threadId, view);
      return view;
    },
    subscribe(threadId: string | undefined, listener: () => void) {
      const set = listeners.get(threadId) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(threadId, set);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(threadId);
      };
    },
    append(entries: Array<[string, PendingDelta]>) {
      const streaming = { ...snapshot.streaming };
      const reasoning = { ...snapshot.reasoning };
      const changed: string[] = [];
      for (const [threadId, delta] of entries) {
        if (!delta.text && !delta.reasoning) continue;
        if (delta.text) streaming[threadId] = (streaming[threadId] ?? "") + delta.text;
        if (delta.reasoning) reasoning[threadId] = (reasoning[threadId] ?? "") + delta.reasoning;
        changed.push(threadId);
      }
      if (!changed.length) return;
      snapshot = { streaming, reasoning };
      notify(changed);
    },
    clear(threadId: string) {
      if (!(threadId in snapshot.streaming) && !(threadId in snapshot.reasoning)) return;
      const { [threadId]: _text, ...streaming } = snapshot.streaming;
      const { [threadId]: _reasoning, ...reasoning } = snapshot.reasoning;
      snapshot = { streaming, reasoning };
      notify([threadId]);
    },
    reset() {
      const changed = [...new Set([...Object.keys(snapshot.streaming), ...Object.keys(snapshot.reasoning)])];
      snapshot = EMPTY_STREAM;
      if (changed.length) notify(changed);
    },
  };
}

/** Batch paints by frame, with a fallback for background tabs. The pending
 * threshold drains intact text; it never truncates the accumulated reply. */
export function createStreamDeltaBuffer(onFlush: (entries: Array<[string, PendingDelta]>) => void) {
  const buffer = new Map<string, PendingDelta>();
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let characters = 0;
  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    cancel();
    if (!buffer.size) return;
    const entries = [...buffer];
    buffer.clear();
    characters = 0;
    onFlush(entries);
  };
  return {
    push(threadId: string, kind: string, delta: string) {
      if (kind !== "assistant_text" && kind !== "reasoning_text") return;
      const entry = buffer.get(threadId) ?? { text: "", reasoning: "" };
      if (kind === "assistant_text") entry.text += delta;
      else entry.reasoning += delta;
      buffer.set(threadId, entry);
      characters += delta.length;
      if (characters >= 64 * 1024) flush();
      else if (frame === null) {
        frame = requestAnimationFrame(flush);
        timer = setTimeout(flush, 100);
      }
    },
    clear(threadId: string) {
      const entry = buffer.get(threadId);
      if (entry) characters -= entry.text.length + entry.reasoning.length;
      buffer.delete(threadId);
      if (!buffer.size) cancel();
    },
    flush,
    dispose() {
      cancel();
      buffer.clear();
      characters = 0;
    },
  };
}
