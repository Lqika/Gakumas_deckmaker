import { getValue, setValue } from "../lib/redis.js";
import { verifyToken, bearer } from "../lib/auth.js";

// 共有マスターデータ（パラメータ・カード・シナリオ等）の読み書き。
// 読み取り：誰でも可 ／ 書き込み：管理者トークン必須（サーバー側で検証）。
const ALLOWED = /^master:[A-Za-z0-9:_-]{1,80}$/; // master:〜 のキーだけ許可

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const key = String(req.query.key || "");
      if (!ALLOWED.test(key)) return res.status(400).json({ error: "invalid key" });
      const value = await getValue(key);
      return res.status(200).json({ value });
    }
    if (req.method === "PUT") {
      if (!verifyToken(bearer(req))) return res.status(401).json({ error: "管理者ログインが必要です" });
      const { key, value } = req.body || {};
      if (!ALLOWED.test(String(key)) || typeof value !== "string") return res.status(400).json({ error: "invalid body" });
      await setValue(key, value);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
}
