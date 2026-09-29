import crypto from "node:crypto";

// 管理者パスワードは Vercel の環境変数 ADMIN_PASSWORD に設定（コードには書かない）。
// ログイン成功時に、HMAC署名付きの有効期限つきトークンを発行する（署名鍵は AUTH_SECRET、未設定なら ADMIN_PASSWORD を流用）。
const TTL_MS = 12 * 60 * 60 * 1000; // 12時間

const secret = () => process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || "";
const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function issueToken() {
  const payload = String(Date.now() + TTL_MS);
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (!secret() || typeof token !== "string") return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (!safeEqual(sig, sign(payload))) return false;
  return Number(payload) > Date.now();
}

export function bearer(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}
