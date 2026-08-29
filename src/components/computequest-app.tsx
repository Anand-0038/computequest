"use client";

import { FormEvent, useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { Presentation } from "@/domain/presentation";
import { SponsorQuest } from "@/components/sponsor-quest";

type RuntimeStatus = {
  status?: "ready" | "configuration_required" | "preflight_failed";
  missing?: string[];
  issues?: string[];
  error?: string;
};

type TaskResponse = {
  task?: { id: string; status: string };
  job?: { id: string; status: string } | null;
  quest?: { state: string } | null;
  settlement?: { status?: string; transactionHash?: string | null } | null;
  balance?: number;
  shortage?: number;
  error?: string;
};

type TaskSnapshot = {
  task: { id: string; status: string; estimatedCost: number };
  balance: number;
  job: { id: string; status: string; structuredResult?: Presentation | null } | null;
  quest: { state: string } | null;
  settlement: { status?: string; transactionHash?: string | null } | null;
};

const stages = ["Brief", "Fund", "Attention", "Monad settlement", "AI working", "Result"];
const themeStorageKey = "computequest:theme";

type Theme = "dark" | "light";

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener("computequest:theme-change", onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener("computequest:theme-change", onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function ComputeQuestApp() {
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, () => "dark");
  const [prompt, setPrompt] = useState("");
  const [health, setHealth] = useState<RuntimeStatus | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(true);
  const [task, setTask] = useState<TaskResponse | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.localStorage.getItem("computequest:active-task"),
  );
  const [submitting, setSubmitting] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [result, setResult] = useState<{ presentation: Presentation; transactionHash: string } | null>(null);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem(themeStorageKey, nextTheme);
    window.dispatchEvent(new Event("computequest:theme-change"));
  }

  const checkHealth = useCallback(() => {
    setCheckingHealth(true);
    fetch("/api/health", { cache: "no-store" })
      .then(async (response) => (await response.json()) as RuntimeStatus)
      .then(setHealth)
      .catch(() => setHealth({ error: "Runtime health check is unreachable." }))
      .finally(() => setCheckingHealth(false));
  }, []);

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then(async (response) => (await response.json()) as RuntimeStatus)
      .then(setHealth)
      .catch(() => setHealth({ error: "Runtime health check is unreachable." }))
      .finally(() => setCheckingHealth(false));
  }, []);

  useEffect(() => {
    if (health?.status !== "ready" || sessionReady) return;
    fetch("/api/session", { method: "POST" })
      .then(async (response) => {
        const body = (await response.json()) as { ready?: boolean; error?: string };
        if (!response.ok || !body.ready) throw new Error(body.error ?? "SESSION_CREATE_FAILED");
        setSessionReady(true);
      })
      .catch((error) => setSessionError(error instanceof Error ? error.message : "SESSION_CREATE_FAILED"));
  }, [health?.status, sessionReady]);

  const applyTaskSnapshot = useCallback((snapshot: TaskSnapshot) => {
    setTask({
      task: snapshot.task,
      balance: snapshot.balance,
      shortage:
        snapshot.task.status === "AWAITING_CREDITS"
          ? Math.max(0, snapshot.task.estimatedCost - snapshot.balance)
          : 0,
      job: snapshot.job ? { id: snapshot.job.id, status: snapshot.job.status } : null,
      quest: snapshot.quest,
      settlement: snapshot.settlement,
    });
    if (snapshot.job?.structuredResult && snapshot.settlement?.transactionHash) {
      setResult({
        presentation: snapshot.job.structuredResult,
        transactionHash: snapshot.settlement.transactionHash,
      });
    }
  }, []);

  const refreshTask = useCallback(async (taskId: string) => {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
    if (!response.ok) return;
    applyTaskSnapshot((await response.json()) as TaskSnapshot);
  }, [applyTaskSnapshot]);

  useEffect(() => {
    if (!sessionReady || !activeTaskId) return;
    const initialRefresh = window.setTimeout(() => {
      void refreshTask(activeTaskId).catch(() => undefined);
    }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshTask(activeTaskId).catch(() => undefined);
    }, 2_000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
    };
  }, [activeTaskId, refreshTask, sessionReady]);

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setTask(null);

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const result = (await response.json()) as TaskResponse;
      setTask(result);
      if (result.task) {
        window.localStorage.setItem("computequest:active-task", result.task.id);
        setActiveTaskId(result.task.id);
      }
    } catch {
      setTask({ error: "The ComputeQuest server is unreachable." });
    } finally {
      setSubmitting(false);
    }
  }

  function downloadPresentation() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.presentation, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.presentation.title.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "computequest-deck"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const activeStage = deriveActiveStage({ result: Boolean(result), task });

  async function handleQuestComplete(presentation: Presentation, transactionHash: string) {
    setResult({ presentation, transactionHash });
    if (activeTaskId) await refreshTask(activeTaskId).catch(() => undefined);
  }

  return (
    <main className="cq-shell">
      <header className="cq-nav">
        <a className="cq-brand" href="#top" aria-label="ComputeQuest home">
          <span className="cq-brand-mark">CQ</span>
          <span>ComputeQuest</span>
        </a>
        <div className="cq-nav-actions">
          <div className="cq-network" title="All settlement is restricted to Monad Testnet">
            <span className={health?.status === "ready" ? "status-dot ready" : "status-dot"} />
            MONAD TESTNET
          </div>
          <button
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            aria-pressed={theme === "light"}
            className="theme-toggle"
            onClick={toggleTheme}
            type="button"
          >
            <span aria-hidden="true" className="theme-toggle-icon">
              {theme === "dark" ? "☼" : "◐"}
            </span>
            <span>{theme === "dark" ? "LIGHT" : "DARK"}</span>
          </button>
        </div>
      </header>

      <section className="cq-hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">COMPUTE SHOULD BE EARNED, NOT BLOCKED</p>
          <h1>
            Turn attention into
            <span> compute energy.</span>
          </h1>
          <p className="lede">
            Describe the deck you need. If you are short on credits, complete a verified sponsor
            quest, settle the reward on Monad Testnet, and send the real job to Gemini.
          </p>
        </div>

        <aside className="energy-panel" aria-label="Compute energy economics">
          <div className="energy-topline">
            <span>COMPUTE CELL</span>
            <span>24 CE / DECK</span>
          </div>
          <div className="energy-orbit">
            <span className="energy-core">CE</span>
          </div>
          <p>Credits move only after an onchain settlement is confirmed.</p>
        </aside>
      </section>

      <section className="cq-workbench" aria-labelledby="brief-title">
        <div className="stage-rail" aria-label="ComputeQuest progress">
          {stages.map((stage, index) => (
            <div className={`stage ${index <= activeStage ? "active" : ""}`} key={stage}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {stage}
            </div>
          ))}
        </div>

        <div className="workbench-grid">
          <div>
            <p className="eyebrow">01 / DEFINE THE WORK</p>
            <h2 id="brief-title">What should the factory build?</h2>
            <p className="supporting-copy">
              Give the audience, objective, and essential facts. The generator is instructed not
              to invent traction or unsupported claims.
            </p>
          </div>

          <form className="task-form" onSubmit={submitTask}>
            <label htmlFor="task-prompt">PITCH DECK BRIEF</label>
            <textarea
              id="task-prompt"
              minLength={12}
              maxLength={1000}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Create an 8-slide technical pitch deck for..."
              required
              value={prompt}
            />
            <div className="form-footer">
              <span>{prompt.length} / 1000</span>
              <button disabled={!sessionReady || health?.status !== "ready" || submitting || prompt.trim().length < 12} type="submit">
                {submitting ? "CHECKING LEDGER…" : "START BUILD — 24 CE"}
              </button>
            </div>
          </form>
        </div>

        {checkingHealth ? (
          <div className="system-message runtime-message" aria-live="polite" role="status">
            <span>CHECKING RUNTIME</span>
            <p>Verifying the database and deployed Monad campaign before accepting work.</p>
          </div>
        ) : health?.status === "configuration_required" ? (
          <div className="system-message error runtime-message" role="alert">
            <span>RUNTIME NOT READY</span>
            <div>
              <p>
                Deployment configuration is incomplete
                {health.missing?.length ? `: ${health.missing.join(", ")}` : "."}
              </p>
              <button onClick={checkHealth} type="button">RECHECK RUNTIME</button>
            </div>
          </div>
        ) : health?.error ? (
          <div className="system-message error runtime-message" role="alert">
            <span>RUNTIME UNREACHABLE</span>
            <div>
              <p>{health.error}</p>
              <button onClick={checkHealth} type="button">RECHECK RUNTIME</button>
            </div>
          </div>
        ) : null}

        {task?.error ? (
          <div className="system-message error" role="alert">
            <span>CONFIGURATION REQUIRED</span>
            <p>{task.error}</p>
          </div>
        ) : null}

        {sessionError ? (
          <div className="system-message error" role="alert">
            <span>SESSION UNAVAILABLE</span>
            <p>{sessionError}</p>
          </div>
        ) : null}

        {health?.status === "preflight_failed" ? (
          <div className="system-message error" role="alert">
            <span>MONAD PREFLIGHT FAILED</span>
            <div>
              <p>{health.issues?.join(" · ") || "The configured Testnet runtime could not be verified."}</p>
              <button onClick={checkHealth} type="button">RECHECK RUNTIME</button>
            </div>
          </div>
        ) : null}

        {task?.task ? (
          <div className="system-message success" aria-live="polite">
            <span>{task.task.status.replaceAll("_", " ")}</span>
            <p>
              Task {task.task.id.slice(0, 8)} was persisted. Ledger balance: {task.balance} CE.
              {task.shortage ? ` ${task.shortage} CE must be earned before generation.` : " The real Gemini job is funded."}
            </p>
          </div>
        ) : null}

        {!result && task?.task && (Boolean(task.shortage) || task.job?.status === "REFUNDED") ? (
          <SponsorQuest
            balance={task.balance ?? 0}
            initialRetryJobId={task.job?.status === "REFUNDED" ? task.job.id : null}
            initialSettlementHash={task.settlement?.transactionHash ?? null}
            shortage={task.shortage ?? 0}
            taskId={task.task.id}
            onComplete={handleQuestComplete}
          />
        ) : null}
      </section>

      {result ? (
        <section className="result-deck" aria-labelledby="result-title">
          <p className="eyebrow">REAL GEMINI OUTPUT · FUNDED BY SPONSOR QUEST</p>
          <h2 id="result-title">{result.presentation.title}</h2>
          <p>{result.presentation.subtitle}</p>
          <div className="slide-grid">
            {result.presentation.slides.map((slide, index) => (
              <article key={`${slide.title}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{slide.title}</h3>
                <ul>{slide.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
              </article>
            ))}
          </div>
          <div className="result-actions">
            <button onClick={downloadPresentation} type="button">DOWNLOAD GENERATED JSON</button>
            <a href={`https://testnet.monadvision.com/tx/${result.transactionHash}`} target="_blank" rel="noreferrer">
              VIEW MONAD TESTNET SETTLEMENT ↗
            </a>
          </div>
        </section>
      ) : null}

      <section className="truth-strip" aria-label="System guarantees">
        <div><span>01</span><strong>SERVER-TIMED QUEST</strong><p>Focus and playback heartbeats are checked server-side.</p></div>
        <div><span>02</span><strong>ONCHAIN SETTLEMENT</strong><p>Replay-protected EIP-712 rewards on Monad Testnet.</p></div>
        <div><span>03</span><strong>REAL GENERATION</strong><p>Structured output comes from Gemini or fails visibly.</p></div>
      </section>

      <footer>
        <span>COMPUTEQUEST / MONAD BLITZ</span>
      </footer>
    </main>
  );
}

export function deriveActiveStage(input: { result: boolean; task: TaskResponse | null }) {
  if (input.result || input.task?.job?.status === "COMPLETED") return 5;
  if (input.task?.task?.status === "PROCESSING" || ["FUNDED", "PROCESSING", "REFUNDED"].includes(input.task?.job?.status ?? "")) return 4;
  if (
    ["AUTHORIZED", "SUBMITTING", "SUBMITTED", "CONFIRMED"].includes(input.task?.settlement?.status ?? "") ||
    ["AUTHORIZED", "SETTLING", "SETTLED", "CREDITED", "SETTLEMENT_FAILED"].includes(input.task?.quest?.state ?? "")
  ) return 3;
  if (["CREATED", "ACTIVE", "PAUSED", "VERIFYING"].includes(input.task?.quest?.state ?? "")) return 2;
  if (input.task?.task?.status === "AWAITING_CREDITS") return 1;
  return 0;
}
