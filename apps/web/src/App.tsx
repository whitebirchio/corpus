import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError, type MeResponse } from "./api.js";
import { Login } from "./views/Login.js";
import { Plan } from "./views/Plan.js";
import { Today } from "./views/Today.js";

// Keeps the chart library out of the initial bundle — Today stays light.
const Trends = lazy(() => import("./views/Trends.js").then((m) => ({ default: m.Trends })));
// Same for the scanner: zxing-wasm only loads when the Scan tab opens.
const Scan = lazy(() => import("./views/Scan.js").then((m) => ({ default: m.Scan })));

type Tab = "today" | "plan" | "scan" | "trends";

type Session =
  | { state: "loading" }
  | { state: "anon" }
  | { state: "error"; message: string }
  | { state: "ready"; me: MeResponse };

function tabFromHash(): Tab {
  if (location.hash === "#/trends") return "trends";
  if (location.hash === "#/plan") return "plan";
  if (location.hash === "#/scan") return "scan";
  return "today";
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
    location.hash = `#/${t}`;
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
        ) : tab === "plan" ? (
          <Plan me={me} />
        ) : tab === "scan" ? (
          <Suspense fallback={<div className="center-note">Loading…</div>}>
            <Scan me={me} />
          </Suspense>
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
        <button className={tab === "plan" ? "active" : ""} onClick={() => selectTab("plan")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M5 6.5h14M5 12h14M5 17.5h8" strokeLinecap="round" />
            <path d="M16.5 16.5l1.8 1.8 3-3.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Plan
        </button>
        <button className={tab === "scan" ? "active" : ""} onClick={() => selectTab("scan")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" strokeLinecap="round" />
            <path d="M7.5 9.5v5M10.5 9.5v5M13.5 9.5v5M16.5 9.5v5" strokeLinecap="round" />
          </svg>
          Scan
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
