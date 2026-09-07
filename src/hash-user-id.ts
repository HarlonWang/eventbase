let cached: { secret: string; key: Promise<CryptoKey> } | undefined;

function keyOf(secret: string): Promise<CryptoKey> {
  if (cached?.secret !== secret) {
    cached = {
      secret,
      key: crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      ),
    };
  }
  return cached.key;
}

/** HMAC-SHA256 前 64 位，十六进制 16 字符。同 secret 同输入恒同输出，换 secret 全部假名作废。 */
export async function hashUserId(secret: string, userId: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await keyOf(secret), new TextEncoder().encode(userId));
  return [...new Uint8Array(mac, 0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
