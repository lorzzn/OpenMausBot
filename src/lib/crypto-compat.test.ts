import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { installRandomUuidFallback } from "./crypto-compat";

describe("HTTP UUID compatibility", () => {
  it("produces distinct RFC 4122 version 4 UUIDs when only random bytes are available", () => {
    const crypto = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } as Crypto;
    installRandomUuidFallback(crypto);
    const ids = Array.from({ length: 100 }, () => crypto.randomUUID());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  });

  it("preserves the native UUID function", () => {
    const crypto = { randomUUID: webcrypto.randomUUID.bind(webcrypto) } as Crypto;
    const native = crypto.randomUUID;
    installRandomUuidFallback(crypto);
    expect(crypto.randomUUID).toBe(native);
  });
});
