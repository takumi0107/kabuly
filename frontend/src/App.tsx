import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import StockChat from "./pages/StockChat";

type AuthStatus = "loading" | "ok" | "login";

export default function App() {
  const [auth, setAuth] = useState<AuthStatus>("loading");
  const [userName, setUserName] = useState("");

  useEffect(() => {
    fetch("/auth/me")
      .then((r) => {
        if (r.status === 401) { setAuth("login"); return null; }
        return r.json();
      })
      .then((u) => {
        if (!u) return;
        setUserName(u.name || u.email || "");
        setAuth("ok");
      })
      .catch(() => setAuth("login"));
  }, []);

  if (auth === "loading")
    return (
      <div className="flex items-center justify-center h-screen text-slate-400 text-sm">
        読み込み中…
      </div>
    );

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={auth === "ok" ? <Navigate to="/" replace /> : <Login />}
        />
        {auth === "login" ? (
          <Route path="*" element={<Navigate to="/login" replace />} />
        ) : (
          <>
            <Route path="/" element={<Dashboard userName={userName} />} />
            <Route path="/stock/:ticker" element={<StockChat />} />
            <Route path="/profile" element={<Profile />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
