/**
 * Conversation — a voice+text chat surface, optionally scoped to a project.
 * Shared by the global HUD and each repo's detail panel. Push-to-talk (hold the
 * orb or Space), hands-free loop, and live "thinking / calling tool" status.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProcessResult, TurnStatusEvent } from "../../shared/ipc.js";
import { playMp3Base64, startRecording, type RecorderHandle } from "./voice.js";

interface Line {
  who: "you" | "praxis";
  text: string;
  tag?: string;
}

type Phase = "idle" | "listening" | "thinking" | "speaking";

/** Inline setup shown when voice isn't configured — paste an ElevenLabs key to
 *  enable voice live (no restart). Saved to the per-user config for next time. */
function VoiceSetup(): JSX.Element {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = async (): Promise<void> => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.praxis.setVoiceConfig({ apiKey: key.trim() });
      if (!res.ok) setError(res.detail ?? "Couldn't enable voice.");
      // On success the status broadcast flips the UI to the voice controls.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="voice-setup">
      <p className="hint">
        Voice isn’t configured. Paste your ElevenLabs API key to enable it — you can still type meanwhile.
      </p>
      <div className="voice-setup-row">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk_… ElevenLabs API key"
          onKeyDown={(e) => e.key === "Enter" && void enable()}
        />
        <button className="primary" disabled={busy || !key.trim()} onClick={() => void enable()}>
          {busy ? "Enabling…" : "Enable voice"}
        </button>
      </div>
      {error && <p className="voice-setup-error">{error}</p>}
    </div>
  );
}

export function Conversation({
  projectId,
  canVoice,
  compact,
}: {
  projectId?: string;
  canVoice: boolean;
  compact?: boolean;
}): JSX.Element {
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<string>("");
  const [handsFree, setHandsFree] = useState(false);
  const [typed, setTyped] = useState("");

  const recorderRef = useRef<RecorderHandle | null>(null);
  const handsFreeRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);

  useEffect(() => {
    return window.praxis.onTurnStatus((e: TurnStatusEvent) => {
      if ((e.projectId ?? "") === (projectId ?? "")) setStatus(e.detail);
    });
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, phase]);

  const handleResult = useCallback(async (res: ProcessResult) => {
    setStatus("");
    if (res.userText) setLines((l) => [...l, { who: "you", text: res.userText }]);
    const tag =
      res.result.intent === "task"
        ? res.result.dispatched?.ok
          ? "task dispatched"
          : "dispatch failed"
        : undefined;
    setLines((l) => [...l, { who: "praxis", text: res.result.reply, tag }]);
    if (res.audioBase64) {
      setPhase("speaking");
      await playMp3Base64(res.audioBase64);
    }
    setPhase("idle");
    if (handsFreeRef.current) void beginListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginListening = useCallback(async () => {
    if (recorderRef.current || !canVoice) return;
    try {
      recorderRef.current = await startRecording();
      setPhase("listening");
    } catch {
      setPhase("idle");
    }
  }, [canVoice]);

  const stopAndSend = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setPhase("thinking");
    try {
      const { audio, mimeType } = await rec.stop();
      const res = await window.praxis.processAudio({ audio, mimeType, projectId });
      await handleResult(res);
    } catch (err) {
      setLines((l) => [...l, { who: "praxis", text: `Something went wrong: ${(err as Error).message}` }]);
      setPhase("idle");
    }
  }, [handleResult, projectId]);

  const sendTyped = useCallback(async () => {
    const text = typed.trim();
    if (!text) return;
    setTyped("");
    setPhase("thinking");
    try {
      const res = await window.praxis.processText({ text, projectId });
      await handleResult(res);
    } catch (err) {
      setLines((l) => [...l, { who: "praxis", text: `Error: ${(err as Error).message}` }]);
      setPhase("idle");
    }
  }, [typed, handleResult, projectId]);

  const orbClass = `orb orb-${phase}`;

  return (
    <div className={`conversation ${compact ? "compact" : ""}`}>
      <div className="transcript" ref={scrollRef}>
        {!canVoice && <VoiceSetup />}
        {lines.length === 0 && canVoice && (
          <p className="hint">Hold the orb (or Space) and talk, or type below.</p>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`bubble ${l.who}`}>
            <div className="text">{l.text}</div>
            {l.tag && <div className="tag">{l.tag}</div>}
          </div>
        ))}
        {phase === "thinking" && <div className="bubble praxis pending">{status || "thinking…"}</div>}
      </div>

      <div className="controls">
        <button
          className={orbClass}
          disabled={!canVoice}
          onPointerDown={() => void beginListening()}
          onPointerUp={() => void stopAndSend()}
          onPointerLeave={() => recorderRef.current && void stopAndSend()}
          title="Hold to talk"
        >
          {phase === "listening" ? "Listening…" : phase === "speaking" ? "Speaking…" : "Hold to talk"}
        </button>
        <label className="handsfree">
          <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} />
          hands-free
        </label>
      </div>

      <form
        className="typer"
        onSubmit={(e) => {
          e.preventDefault();
          void sendTyped();
        }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type a message…" />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
