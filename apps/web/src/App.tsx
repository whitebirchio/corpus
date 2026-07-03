import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError, type MeResponse } from "./api.js";
import { Login } from "./views/Login.js";
import { Today } from "./views/Today.js";

// Keeps the chart library out of the initial bundle — Today stays light.
const Trends = lazy(() => import("./views/Trends.js").then((m) => ({ default: m.Trends })));

type Tab = "today" | "trends";

type Session =
  | { state: "loading" }
  | { state: "anon" }
  | { state: "error"; message: string }
  | { state: "ready"; me: MeResponse };

function tabFromHash(): Tab {
  return location.hash === "#/trends" ? "trends" : "today";
}

export function App() {
  const [session, setSession] = useState<Session>({ state: "loading" });
  const [tab, setTab] = useState<Tab>(tabFromHash());

  const loadSession = useCallback(async () => {
    try {
      setSession({ state: "ready", me: await api.me() });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setSession({ state: "anon" });
      } else {
        setSession({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const selectTab = (t: Tab) => {
    location.hash = t === "trends" ? "#/trends" : "#/today";
    setTab(t);
  };

  const logout = async () => {
    await api.logout();
    setSession({ state: "anon" });
  };

  if (session.state === "loading") {
    return <div className="center-note">Loading…</div>;
  }
  if (session.state === "anon") {
    return <Login />;
  }
  if (session.state === "error") {
    return (
      <div className="login">
        <p className="error">{session.message}</p>
        <button className="google-button" onClick={() => void loadSession()}>
          Retry
        </button>
      </div>
    );
  }

  const { me } = session;
  return (
    <>
      <header className="app-header">
        <div className="app-title">Corpus</div>
        <button className="subtle-button" onClick={() => void logout()}>
          Sign out
        </button>
      </header>
      <main className="app-main">
        {tab === "today" ? (
          <Today me={me} />
        ) : (
          <Suspense fallback={<div className="center-note">Loading…</div>}>
            <Trends me={me} />
          </Suspense>
        )}
      </main>
      <nav className="tab-bar">
        <button className={tab === "today" ? "active" : ""} onClick={() => selectTab("today")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
            <path d="M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4" />
          </svg>
          Today
        </button>
        <button className={tab === "trends" ? "active" : ""} onClick={() => selectTab("trends")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3.5 19.5h17" strokeLinecap="round" />
            <path d="M4.5 15l4.2-5 3.8 3.2 6-7.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Trends
        </button>
      </nav>
    </>
  );
}
