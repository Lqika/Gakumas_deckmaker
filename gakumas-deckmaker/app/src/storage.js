/* ============================================================
   window.storage 互換の保存レイヤー（Vercel公開用）
   - shared=true  … 全ユーザー共通のマスターデータ。サーバー（/api/master → Upstash Redis）に保存。
                    読み取りは誰でも可、書き込みは管理者ログイン（トークン）が必須。
   - shared=false … 利用者ごとのデータ（所持状況・設定）。そのユーザーのブラウザ（localStorage）に保存。
   ============================================================ */

const TOKEN_KEY = "supoka:adminToken";
const LOCAL_PREFIX = "supoka:";

// 「一度だけ実行する修正」の実行済みフラグ。公開版では初期データが最新のため、常に実行済み扱いにする
// （利用者ごとに再実行されて、管理者が手で直した内容を上書きするのを防ぐ）。
const isMigrationFlag = (key) => key.startsWith("master:migration:");

export const getAdminToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
};
const setAdminToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* 無視 */ }
};

export async function adminLogin(password) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.token) throw new Error(json.error || "ログインに失敗しました");
  setAdminToken(json.token);
  return true;
}

export function adminLogout() {
  setAdminToken("");
}

export async function adminVerify() {
  const token = getAdminToken();
  if (!token) return false;
  try {
    const res = await fetch("/api/verify", { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!json.admin) setAdminToken("");
    return !!json.admin;
  } catch {
    return false;
  }
}

window.storage = {
  async get(key, shared) {
    if (shared) {
      if (isMigrationFlag(key)) return { key, value: "done", shared: true };
      const res = await fetch(`/api/master?key=${encodeURIComponent(key)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`load failed: ${res.status}`);
      const json = await res.json();
      if (json.value == null) throw new Error("not found");
      return { key, value: json.value, shared: true };
    }
    const v = localStorage.getItem(LOCAL_PREFIX + key);
    if (v == null) throw new Error("not found");
    return { key, value: v, shared: false };
  },

  async set(key, value, shared) {
    if (shared) {
      if (isMigrationFlag(key)) return { key, value, shared: true };
      const token = getAdminToken();
      if (!token) return null; // 管理者以外はマスターを書き換えない（サーバー側でも拒否される）
      const res = await fetch("/api/master", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key, value }),
      });
      if (res.status === 401) {
        setAdminToken("");
        window.dispatchEvent(new Event("admin-expired"));
        throw new Error("unauthorized");
      }
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      return { key, value, shared: true };
    }
    localStorage.setItem(LOCAL_PREFIX + key, value);
    return { key, value, shared: false };
  },

  async delete(key, shared) {
    if (!shared) localStorage.removeItem(LOCAL_PREFIX + key);
    return { key, deleted: !shared, shared: !!shared };
  },

  async list(prefix = "", shared) {
    if (shared) return { keys: [], prefix, shared: true };
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LOCAL_PREFIX + prefix)) keys.push(k.slice(LOCAL_PREFIX.length));
    }
    return { keys, prefix, shared: false };
  },
};
