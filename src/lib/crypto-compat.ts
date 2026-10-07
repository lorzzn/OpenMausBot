/** UUIDs remain available on plain HTTP origins using Web Crypto's secure
 * random bytes. Native HTTPS/localhost implementations are left in place. */
export function installRandomUuidFallback(webCrypto: Crypto | undefined = globalThis.crypto): void {
  if (!webCrypto || typeof webCrypto.randomUUID === "function") return;
  Object.defineProperty(webCrypto, "randomUUID", {
    configurable: true,
    value: (): ReturnType<Crypto["randomUUID"]> => {
      const bytes = webCrypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
}

installRandomUuidFallback();
