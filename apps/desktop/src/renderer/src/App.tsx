import { useCallback, useEffect, useRef, useState } from "react";
import type { PraxisStatus } from "../../shared/ipc.js";
import type { ProcessResult } from "../../shared/ipc.js";
import { startRecording, playMp3Base64, type RecorderHandle } from "./voice.js";

interface Line {
  who: "you" | "praxis";
  text: string;
  tag?: string;
}

type Phase = "idle" | "listening" | "thinking" | "speaking";

export function App(): JSX.Element {
  const [status, setStatus] = useState<PraxisStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [handsFree, setHandsFree] = useState(false);
  const [typed, setTyped] = useState("");

  const recorderRef = useRef<RecorderHandle | null>(null);
  const handsFreeRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);

  useEffect(() => {
    void window.praxis.getStatus().then(setStatus);
    const off = window.praxis.onSummon(() => void beginListening());
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, phase]);

  const handleResult = useCallback(async (res: ProcessResult) => {
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
    if (recorderRef.current) return;
    try {
      recorderRef.current = await startRecording();
      setPhase("listening");
    } catch {
      setPhase("idle");
    }
  }, []);

  const stopAndSend = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setPhase("thinking");
    try {
      const { audio, mimeType } = await rec.stop();
      const res = await window.praxis.processAudio({ audio, mimeType });
      await handleResult(res);
    } catch (err) {
      setLines((l) => [...l, { who: "praxis", text: `Something went wrong: ${(err as Error).message}` }]);
      setPhase("idle");
    }
  }, [handleResult]);

  const sendTyped = useCallback(async () => {
    const text = typed.trim();
    if (!text) return;
    setTyped("");
    setPhase("thinking");
    try {
      const res = await window.praxis.processText({ text });
      await handleResult(res);
    } catch (err) {
      setLines((l) => [...l, { who: "praxis", text: `Error: ${(err as Error).message}` }]);
      setPhase("idle");
    }
  }, [typed, handleResult]);

  // Spacebar push-to-talk (ignore while typing in the input).
  useEffect(() => {
    const isTyping = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
    const down = (e: KeyboardEvent): void => {
      if (e.code === "Space" && !e.repeat && !isTyping(e.target) && phase === "idle") {
        e.preventDefault();
        void beginListening();
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === "Space" && !isTyping(e.target) && recorderRef.current) {
        e.preventDefault();
        void stopAndSend();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [phase, beginListening, stopAndSend]);

  const orbClass = `orb orb-${phase}`;
  const canTalk = Boolean(status?.hasVoice);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Praxis</span>
        <span className={`dot ${status?.brainReady ? "ok" : "warn"}`} title="brain status" />
        <label className="handsfree">
          <input
            type="checkbox"
            checked={handsFree}
            onChange={(e) => setHandsFree(e.target.checked)}
          />
          hands-free
        </label>
      </header>

      <div className="transcript" ref={scrollRef}>
        {lines.length === 0 && (
          <p className="hint">
            {canTalk
              ? `Hold the button (or Space) and talk. Try “what did we just do on Roomies?”`
              : `Voice isn’t configured yet — add ELEVENLABS_API_KEY to .env. You can still type below.`}
          </p>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`bubble ${l.who}`}>
            <div className="text">{l.text}</div>
            {l.tag && <div className="tag">{l.tag}</div>}
          </div>
        ))}
        {phase === "thinking" && <div className="bubble praxis pending">thinking…</div>}
      </div>

      <div className="controls">
        <button
          className={orbClass}
          disabled={!canTalk}
          onPointerDown={() => void beginListening()}
          onPointerUp={() => void stopAndSend()}
          onPointerLeave={() => recorderRef.current && void stopAndSend()}
          title="Hold to talk"
        >
          {phase === "listening" ? "Listening…" : phase === "speaking" ? "Speaking…" : "Hold to talk"}
        </button>

        <form
          className="typer"
          onSubmit={(e) => {
            e.preventDefault();
            void sendTyped();
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="…or type a message"
          />
          <button type="submit">Send</button>
        </form>
      </div>
    </div>
  );
}
