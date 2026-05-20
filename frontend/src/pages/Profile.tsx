import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { UserProfile } from "../types";

const STYLES = [
  { value: "conservative", label: "🛡 慎重", desc: "確信度4以上のシグナルのみ分析に反映。" },
  { value: "normal",       label: "⚖ 普通", desc: "確信度3以上で分析に反映。" },
  { value: "aggressive",   label: "🚀 強気", desc: "確信度2以上で分析に反映。" },
];

export default function Profile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [style, setStyle] = useState("normal");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getProfile().then((p) => {
      setProfile(p);
      setStyle(p.Style);
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.saveProfile({ style });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!profile)
    return <div className="flex items-center justify-center h-screen text-slate-400 text-sm">読み込み中…</div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-lg mx-auto px-5 py-3.5 flex items-center gap-3">
          <Link to="/" className="text-slate-400 hover:text-slate-600 text-lg transition-colors">←</Link>
          <h1 className="font-bold text-slate-900">投資プロファイル設定</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-10">
        <div className="bg-white border border-slate-200 rounded-2xl p-7 shadow-sm">
          <h2 className="font-bold text-slate-800 mb-6">投資スタイル</h2>

          <form onSubmit={save} className="space-y-6">
            <div className="space-y-2">
              {STYLES.map((s) => (
                <label
                  key={s.value}
                  className={`flex items-start gap-3 p-3.5 border rounded-xl cursor-pointer transition-colors ${
                    style === s.value
                      ? "border-blue-400 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="style"
                    value={s.value}
                    checked={style === s.value}
                    onChange={() => setStyle(s.value)}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div>
                    <div className="font-semibold text-sm text-slate-800">{s.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{s.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors">
              保存する
            </button>

            {saved && <p className="text-center text-emerald-600 text-sm font-medium">✓ 保存しました</p>}
          </form>
        </div>
      </main>
    </div>
  );
}
