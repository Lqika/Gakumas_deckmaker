import { issueToken, safeEqual } from "../lib/auth.js";

// 総当たり対策：失敗のたびに少し待たせる（簡易）。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(500).json({ error: "ADMIN_PASSWORD が未設定です" });
  const password = (req.body && req.body.password) || "";
  if (!safeEqual(password, expected)) {
    await sleep(1000);
    return res.status(401).json({ error: "パスワードが違います" });
  }
  return res.status(200).json({ token: issueToken() });
}
