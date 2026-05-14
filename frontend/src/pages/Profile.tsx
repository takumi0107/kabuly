import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { UserProfile } from "../types";

const STYLES = [
  {
    value: "conservative",
    label: "🛡 慎重",
    desc: "確信度4以上のみ推奨。推奨額は最大枠の50%。",
  },
  {
    value: "normal",
    label: "⚖ 普通",
    desc: "確信度3以上で推奨。推奨額は最大枠の70%。",
  },
  {
    value: "aggressive",
    label: "🚀 強気",
    desc: "確信度2以上で推奨。推奨額は最大枠の100%。",
  },
];

export default function Profile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [funds, setFunds] = useState("");
  const [maxPct, setMaxPct] = useState("");
  const [style, setStyle] = useState("normal");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getProfile().then((p) => {
      setProfile(p);
      setFunds(String(Math.round(p.TotalFunds)));
      setMaxPct(String(Math.round(p.MaxPositionPct)));
      setStyle(p.Style);
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.saveProfile({
        total_funds: parseFloat(funds),
        max_position_pct: parseFloat(maxPct),
        style,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const inputCls =
    "w-full bg-[#0f1117] border border-[#2a2d3a] text-slate-200 rounded-lg px-4 py-2.5 text-base focus:outline-none focus:border-blue-500";

  if (!profile)
    return (
      <div className="flex items-center justify-center h-screen text-slate-400">
        読み込み中…
      </div>
    );

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-[#2a2d3a]">
        <Link to="/" className="text-slate-400 text-lg">←</Link>
        <h1 className="font-bold text-lg">⚙ 投資プロファイル設定</h1>
      </header>

      <main className="max-w-md mx-auto px-4 py-10">
        <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl p-7">
          <h2 className="font-bold text-base mb-6">あなたの投資設定</h2>

          <form onSubmit={save} className="space-y-6">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 uppercase tracking-widest">
                総資金（円）
              </label>
              <input
                type="number"
                className={inputCls}
                value={funds}
                onChange={(e) => setFunds(e.target.value)}
                min={0}
                step={10000}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 uppercase tracking-widest">
                1銘柄への最大投資割合（%）
              </label>
              <input
                type="number"
                className={inputCls}
                value={maxPct}
                onChange={(e) => setMaxPct(e.target.value)}
                min={1}
                max={100}
                step={1}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400 uppercase tracking-widest">
                投資スタイル
              </label>
              {STYLES.map((s) => (
                <label
                  key={s.value}
                  className={`flex items-start gap-3 p-3.5 border rounded-xl cursor-pointer transition-colors ${
                    style === s.value
                      ? "border-blue-500 bg-blue-500/5"
                      : "border-[#2a2d3a] hover:border-slate-500"
                  }`}
                >
                  <input
                    type="radio"
                    name="style"
                    value={s.value}
                    checked={style === s.value}
                    onChange={() => setStyle(s.value)}
                    className="mt-0.5 accent-blue-500"
                  />
                  <div>
                    <div className="font-semibold text-sm">{s.label}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{s.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              保存する
            </button>

            {saved && (
              <p className="text-center text-green-400 text-sm">✓ 保存しました</p>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
