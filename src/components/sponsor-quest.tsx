"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import type { Presentation } from "@/domain/presentation";

type Quest = {
  session: {
    id: string;
    state: string;
    accumulatedActiveMs: number;
    lastHeartbeatSequence: number;
    lastHeartbeatEligible: boolean;
    lastAttentionReason: string;
  };
  campaign: {
    creativeTitle: string;
    creditReward: number;
    requiredActiveSeconds: number;
  };
};

type AttentionSignals = {
  documentVisible: boolean;
  windowFocused: boolean;
  fullscreen: boolean;
  pictureInPicture: boolean;
  buffering: boolean;
  mediaPlaying: boolean;
  playbackRate: number;
};

const initialAttentionSignals: AttentionSignals = {
  documentVisible: true,
  windowFocused: true,
  fullscreen: false,
  pictureInPicture: false,
  buffering: false,
  mediaPlaying: false,
  playbackRate: 1,
};

type Props = {
  taskId: string;
  balance: number;
  shortage: number;
  initialRetryJobId: string | null;
  initialSettlementHash: string | null;
  onComplete: (presentation: Presentation, transactionHash: string) => void | Promise<void>;
};

async function postJson<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? `REQUEST_FAILED:${response.status}`);
  return result;
}

export function SponsorQuest({
  taskId,
  balance,
  shortage,
  initialRetryJobId,
  initialSettlementHash,
  onComplete,
}: Props) {
  const [quest, setQuest] = useState<Quest | null>(null);
  const [playing, setPlaying] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [phase, setPhase] = useState("READY TO EARN");
  const [error, setError] = useState<string | null>(null);
  const [retryJobId, setRetryJobId] = useState<string | null>(initialRetryJobId);
  const [settlementHash, setSettlementHash] = useState<string | null>(initialSettlementHash);
  const [attentionSignals, setAttentionSignals] = useState(initialAttentionSignals);
  const sequence = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const questConsoleRef = useRef<HTMLElement>(null);
  const bufferingRef = useRef(false);
  const sessionId = quest?.session.id;

  useEffect(() => {
    fetch(`/api/quests?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as Quest) : null))
      .then((restored) => {
        if (!restored) return;
        sequence.current = restored.session.lastHeartbeatSequence;
        setQuest(restored);
        setTracking(["CREATED", "ACTIVE", "PAUSED"].includes(restored.session.state));
        setPhase(restored.session.state.replaceAll("_", " "));
      })
      .catch(() => undefined);
  }, [taskId]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const fullscreen = document.fullscreenElement === questConsoleRef.current;
      setAttentionSignals((current) => ({ ...current, fullscreen }));
      if (!fullscreen && isVideoActuallyPlaying(videoRef.current)) {
        videoRef.current?.pause();
        setPhase("ATTENTION INTERRUPTED — FULLSCREEN EXITED");
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function startQuest() {
    setError(null);
    try {
      const created = await postJson<Quest>("/api/quests", { taskId });
      videoRef.current?.pause();
      if (videoRef.current) videoRef.current.currentTime = 0;
      sequence.current = created.session.lastHeartbeatSequence;
      setQuest(created);
      setPlaying(false);
      setAttentionSignals(initialAttentionSignals);
      setTracking(true);
      setPhase("QUEST READY — PLAY VIDEO");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "QUEST_START_FAILED");
    }
  }

  useEffect(() => {
    if (!sessionId || !tracking) return;
    const timer = window.setInterval(async () => {
      sequence.current += 1;
      const video = videoRef.current;
      const signals: AttentionSignals = {
        documentVisible: document.visibilityState === "visible",
        windowFocused: document.hasFocus(),
        fullscreen: document.fullscreenElement === questConsoleRef.current,
        pictureInPicture: document.pictureInPictureElement === video,
        buffering: bufferingRef.current || Boolean(video?.seeking) || Boolean(video && video.readyState < 3),
        mediaPlaying: isVideoActuallyPlaying(video),
        playbackRate: video?.playbackRate ?? 1,
      };
      setAttentionSignals(signals);
      try {
        const result = await postJson<{ session: Quest["session"] }>(
          `/api/quests/${sessionId}/heartbeat`,
          {
            sequence: sequence.current,
            ...signals,
            mediaTimeMs: Math.max(0, Math.round((video?.currentTime ?? 0) * 1_000)),
            durationMs: Math.max(1, Math.round(Number.isFinite(video?.duration) ? (video?.duration ?? 0) * 1_000 : 1)),
          },
        );
        setQuest((current) => (current ? { ...current, session: result.session } : current));
        setPhase(
          result.session.state === "PAUSED"
            ? `ATTENTION INTERRUPTED — ${formatAttentionReason(result.session.lastAttentionReason)}`
            : "VERIFIED ATTENTION",
        );
      } catch (cause) {
        videoRef.current?.pause();
        setPlaying(false);
        setTracking(false);
        const message = cause instanceof Error ? cause.message : "HEARTBEAT_REJECTED";
        setPhase(message === "QUEST_EXPIRED" ? "QUEST EXPIRED" : "HEARTBEAT REJECTED");
        setError(message);
      }
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [sessionId, tracking]);

  async function enterAttentionMode() {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    if (!video.paused && !video.ended) {
      video.pause();
      return;
    }
    if (video.ended) video.currentTime = 0;
    try {
      if (document.fullscreenElement !== questConsoleRef.current) {
        if (!questConsoleRef.current?.requestFullscreen) throw new Error("FULLSCREEN_UNAVAILABLE");
        await questConsoleRef.current.requestFullscreen();
      }
      video.playbackRate = 1;
      await video.play();
    } catch {
      setPlaying(false);
      setPhase("VIDEO PLAYBACK BLOCKED");
      setError("VIDEO_PLAYBACK_BLOCKED");
    }
  }

  async function finishQuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quest) return;
    videoRef.current?.pause();
    setPlaying(false);
    setTracking(false);
    setError(null);
    await exitFullscreenIfActive();
    try {
      setPhase("AUTHORIZING VERIFIED ATTENTION");
      await postJson(`/api/quests/${quest.session.id}/authorize`);
      setPhase("SETTLEMENT FINALIZING");
      const settled = await postJson<{
        transactionHash: string;
        taskStatus: string;
        generation: {
          job: { id: string; status: string; structuredResult: Presentation | null } | null;
          error: string | null;
        };
      }>(
        `/api/quests/${quest.session.id}/settle`,
      );
      setSettlementHash(settled.transactionHash);
      const generatedJob = settled.generation.job;
      if (generatedJob?.status === "REFUNDED") {
        setRetryJobId(generatedJob.id);
        throw new Error(settled.generation.error ?? "GEMINI_JOB_FAILED_AND_REFUNDED");
      }
      if (!generatedJob) throw new Error(settled.generation.error ?? "AUTOMATIC_GENERATION_NOT_STARTED");
      setPhase(generatedJob.status === "COMPLETED" ? "COMPLETED" : "BUILDING WITH GEMINI");
      const presentation = generatedJob.structuredResult ?? (await waitForPresentation(taskId));
      await onComplete(presentation, settled.transactionHash);
      setPhase("COMPLETED");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "QUEST_COMPLETION_FAILED";
      setPhase(
        message.includes("RECEIPT_EXPIRED")
          ? "AUTHORIZATION EXPIRED — VERIFY AGAIN"
          : message.includes("GEMINI")
            ? "GENERATION FAILED"
            : "SETTLEMENT FAILED — TRY AGAIN",
      );
      setError(message);
      await discoverRefundedJob();
    }
  }

  async function discoverRefundedJob() {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" });
      if (!response.ok) return;
      const snapshot = (await response.json()) as {
        job?: { id: string; status: string } | null;
        settlement?: { transactionHash: string | null } | null;
      };
      if (snapshot.job?.status === "REFUNDED") setRetryJobId(snapshot.job.id);
      if (snapshot.settlement?.transactionHash) setSettlementHash(snapshot.settlement.transactionHash);
    } catch {
      // The original error remains the user-visible failure.
    }
  }

  async function retryGeneration() {
    if (!retryJobId || !settlementHash) return;
    setError(null);
    setPhase("RETRYING WITH GEMINI");
    try {
      const generated = await postJson<{ job: { structuredResult: Presentation | null } }>(
        `/api/jobs/${retryJobId}/retry`,
      );
      const presentation = generated.job.structuredResult ?? (await waitForPresentation(taskId));
      await onComplete(presentation, settlementHash);
      setRetryJobId(null);
      setPhase("COMPLETED");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "JOB_RETRY_FAILED");
      await discoverRefundedJob();
    }
  }

  if (!quest) {
    return (
      <section className="funding-gap">
        <div><span>CURRENT BALANCE</span><strong>{balance} CE</strong><small>AVAILABLE</small></div>
        <div className="gap-symbol">+</div>
        <div><span>BALANCE GAP</span><strong>{shortage} CE</strong><small>REQUIRED</small></div>
        <button onClick={startQuest} type="button">EARN {shortage} CE</button>
        {error ? <p className="quest-error">{error}</p> : null}
      </section>
    );
  }

  const requiredMs = quest.campaign.requiredActiveSeconds * 1_000;
  const progress = Math.min(100, Math.floor((quest.session.accumulatedActiveMs / requiredMs) * 100));
  const eligible =
    ["ACTIVE", "PAUSED"].includes(quest.session.state) &&
    quest.session.accumulatedActiveMs >= requiredMs;

  return (
    <section className="quest-console" aria-labelledby="quest-heading" ref={questConsoleRef}>
      <div className={`quest-state ${phase.includes("INTERRUPTED") || phase.includes("PAUSED") ? "paused" : ""}`}>{phase}</div>
      <div className="quest-grid">
        <div className="quest-creative">
          <p className="eyebrow">HACKATHON SAMPLE CAMPAIGN · MONAD · +{quest.campaign.creditReward} CE</p>
          <h2 id="quest-heading">{quest.campaign.creativeTitle}</h2>
          <p className="quest-disclosure">Independent ComputeQuest demo creative · Not an official paid Monad advertisement</p>
          <video
            aria-describedby="quest-video-description"
            aria-label="Monad parallel execution sponsor explainer"
            className="sponsor-video"
            onEnded={() => {
              bufferingRef.current = false;
              setPlaying(false);
              setPhase("VIDEO ENDED — REPLAY TO CONTINUE");
            }}
            onError={() => {
              setPlaying(false);
              setTracking(false);
              setPhase("VIDEO UNAVAILABLE");
              setError("SPONSOR_VIDEO_UNAVAILABLE");
            }}
            onLoadedMetadata={(event) => {
              if (event.currentTarget.duration < quest.campaign.requiredActiveSeconds) {
                setTracking(false);
                setPhase("VIDEO DURATION INVALID");
                setError("SPONSOR_VIDEO_SHORTER_THAN_REQUIRED_ACTIVE_VIEW");
              }
            }}
            onPause={() => setPlaying(false)}
            onPlaying={() => {
              bufferingRef.current = false;
              setPlaying(true);
              setPhase("QUEST ACTIVE");
            }}
            onRateChange={(event) => {
              if (Math.abs(event.currentTarget.playbackRate - 1) <= 0.001) return;
              event.currentTarget.pause();
              event.currentTarget.playbackRate = 1;
              setPhase("ATTENTION INTERRUPTED — PLAYBACK RATE CHANGED");
            }}
            onSeeking={() => {
              bufferingRef.current = true;
              setPhase("ATTENTION INTERRUPTED — SEEKING");
            }}
            onSeeked={() => {
              bufferingRef.current = false;
            }}
            onWaiting={() => {
              bufferingRef.current = true;
              setPlaying(false);
              setPhase("VIDEO BUFFERING — PROGRESS PAUSED");
            }}
            playsInline
            disablePictureInPicture
            disableRemotePlayback
            preload="auto"
            ref={videoRef}
            src="/media/monad-parallel-execution.mp4"
          >
            Your browser does not support HTML video playback.
          </video>
          <p className="quest-copy">Independent transactions can execute concurrently while Monad preserves EVM compatibility and deterministic results.</p>
          <p className="sr-only" id="quest-video-description">Playback must remain active at normal speed while this page is visible, focused, and fullscreen. Pausing, seeking, buffering, entering Picture-in-Picture, or leaving fullscreen pauses earned time.</p>
          <button className="media-control" onClick={enterAttentionMode} type="button">
            {playing ? "PAUSE ATTENTION SESSION" : "ENTER ATTENTION MODE"}
          </button>
        </div>
        <div className="quest-progress">
          <span>ATTENTION PROOF</span>
          <strong>{Math.floor(quest.session.accumulatedActiveMs / 1_000)}s / {quest.campaign.requiredActiveSeconds}s</strong>
          <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
          <ul className="attention-signals" aria-label="Current attention proof signals">
            <AttentionSignal active={attentionSignals.documentVisible} label="TAB VISIBLE" />
            <AttentionSignal active={attentionSignals.windowFocused} label="WINDOW FOCUSED" />
            <AttentionSignal active={attentionSignals.fullscreen} label="FULLSCREEN" />
            <AttentionSignal active={attentionSignals.mediaPlaying && !attentionSignals.buffering} label="VIDEO PLAYING" />
            <AttentionSignal active={!attentionSignals.pictureInPicture} label="PICTURE-IN-PICTURE OFF" />
            <AttentionSignal active={Math.abs(attentionSignals.playbackRate - 1) <= 0.001} label="SPEED 1.0×" />
          </ul>
          <p>Server time advances only when every signal passes and video time moves continuously with the heartbeat interval.</p>
          {phase === "QUEST EXPIRED" ? (
            <button className="retry-control" onClick={startQuest} type="button">START A FRESH QUEST</button>
          ) : null}
          <form onSubmit={finishQuest}>
            <p>Complete the required eligible attention time to unlock settlement. No quiz or text answer is required.</p>
            <button disabled={!eligible || phase.includes("FINALIZING") || phase.includes("BUILDING") || phase === "QUEST EXPIRED"} type="submit">
              {eligible ? "SETTLE REWARD ON MONAD" : `ACTIVE VIEW ${progress}%`}
            </button>
          </form>
          {error ? <p className="quest-error" role="alert">{error}</p> : null}
          {retryJobId ? (
            <button className="retry-control" onClick={retryGeneration} type="button">RETRY REFUNDED JOB</button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AttentionSignal({ active, label }: { active: boolean; label: string }) {
  return <li className={active ? "verified" : "interrupted"}><span aria-hidden="true">●</span>{label}</li>;
}

function formatAttentionReason(reason: string) {
  return reason.replaceAll("_", " ");
}

async function waitForPresentation(taskId: string) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    const response = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" });
    if (!response.ok) continue;
    const snapshot = (await response.json()) as {
      task: { status: string };
      job: { structuredResult: Presentation | null } | null;
    };
    if (snapshot.task.status === "COMPLETED" && snapshot.job?.structuredResult) return snapshot.job.structuredResult;
    if (snapshot.task.status === "FAILED") throw new Error("GEMINI_JOB_FAILED_AND_REFUNDED");
  }
  throw new Error("GEMINI_JOB_STILL_PROCESSING");
}

export function isVideoActuallyPlaying(
  video: Pick<HTMLVideoElement, "paused" | "ended" | "readyState" | "seeking"> | null,
) {
  return Boolean(
    video &&
      !video.paused &&
      !video.ended &&
      !video.seeking &&
      video.readyState >= 3,
  );
}

export async function exitFullscreenIfActive() {
  if (!document.fullscreenElement || !document.exitFullscreen) return;
  await document.exitFullscreen().catch(() => undefined);
}
