import { verifyToken, bearer } from "../lib/auth.js";

// 保存済みトークンがまだ有効か確認する（ページ再読み込み時のログイン維持用）。
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ admin: verifyToken(bearer(req)) });
}
