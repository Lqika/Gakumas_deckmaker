// Upstash Redis（Vercel Marketplace）のREST APIを直接叩く最小クライアント。
// 環境変数は Vercel連携なら KV_REST_API_*、Upstash直なら UPSTASH_REDIS_REST_* のどちらでも可。
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function cmd(args) {
  if (!URL_ || !TOKEN) throw new Error("Redisの環境変数が未設定です");
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `Redis error ${res.status}`);
  return json.result;
}

// Upstashの1リクエスト上限（無料枠1MB前後）を超えないよう、大きな値は分割して保存する。
const CHUNK = 400 * 1024;

export async function getValue(key) {
  const meta = await cmd(["GET", `kv:${key}:n`]);
  if (meta == null) return null;
  const n = Number(meta);
  const keys = Array.from({ length: n }, (_, i) => `kv:${key}:${i}`);
  const parts = await cmd(["MGET", ...keys]);
  if (parts.some((p) => p == null)) return null;
  return parts.join("");
}

export async function setValue(key, value) {
  const n = Math.max(1, Math.ceil(value.length / CHUNK));
  for (let i = 0; i < n; i++) {
    await cmd(["SET", `kv:${key}:${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK)]);
  }
  const old = Number((await cmd(["GET", `kv:${key}:n`])) || 0);
  await cmd(["SET", `kv:${key}:n`, String(n)]); // 最後に切り替えることで、途中失敗時も旧データが読める
  for (let i = n; i < old; i++) await cmd(["DEL", `kv:${key}:${i}`]);
}
