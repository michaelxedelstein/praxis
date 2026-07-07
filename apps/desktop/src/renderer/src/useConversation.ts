/**
 * useConversation — the voice + text turn engine, shared by the global Voice HUD
 * and each repo's scoped chat. Owns push-to-talk, the hands-free loop, the wake
 * word ("Hey Jarvis" / "Praxis…") loop, and live "thinking / calling tool"
 * status. The brain still runs in MAIN; this only captures the mic, ships bytes
 * over the bridge, and plays the reply — no API key ever reaches the renderer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProcessResult, TurnStatusEvent, TurnSpeakEvent } from "../../shared/ipc.js";
import {
  queueSpeech,
  recordCommand,
  startRecording,
  startWakeLoop,
  type RecorderHandle,
  type WakeLoopHandle,
} from "./voice.js";

export interface ChatLine {
  who: "you" | "praxis";
  text: string;
  tag?: string;
}

export type Phase = "idle" | "listening" | "thinking" | "speaking";

export interface Conversation {
  phase: Phase;
  lines: ChatLine[];
  status: string;
  handsFree: boolean;
  setHandsFree: (v: boolean) => void;
  wakeWord: boolean;
  setWakeWord: (v: boolean) => void;
  typed: string;
  setTyped: (v: string) => void;
  beginListening: () => void;
  stopAndSend: () => void;
  sendTyped: () => void;
  hasRecorder: () => boolean;
}

export function useConversation({
  projectId,
  canVoice,
  bindPushToTalk = false,
}: {
  projectId?: string;
  canVoice: boolean;
  bindPushToTalk?: boolean;
}): Conversation {
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [status, setStatus] = useState<string>("");
  const [handsFree, setHandsFree] = useState(false);
  const [wakeWord, setWakeWord] = useState(false);
  const [typed, setTyped] = useState("");

  const recorderRef = useRef<RecorderHandle | null>(null);
  const handsFreeRef = useRef(false);
  const wakeRef = useRef<WakeLoopHandle | null>(null);

  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);

  /** Pause/resume the wake loop so Praxis never hears its own speech (or the
   *  active recording) and re-triggers on it. */
  const pauseWake = useCallback((paused: boolean) => {
    wakeRef.current?.setPaused(paused);
  }, []);

  useEffect(() => {
    return window.praxis.onTurnStatus((e: TurnStatusEvent) => {
      if ((e.projectId ?? "") === (projectId ?? "")) setStatus(e.detail);
    });
  }, [projectId]);

  // Live narration: play mid-turn spoken progress lines through the shared queue.
  useEffect(() => {
    return window.praxis.onTurnSpeak((e: TurnSpeakEvent) => {
      if ((e.projectId ?? "") !== (projectId ?? "")) return;
      void queueSpeech(e.audioBase64);
    });
  }, [projectId]);

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
      // Chains after any live-narration clips so it never overlaps them.
      await queueSpeech(res.audioBase64);
    }
    setPhase("idle");
    // In hands-free mode the always-on wake loop resumes listening for "Praxis"
    // on its own — no auto-record here (that would bypass the wake word).
    pauseWake(false);
  }, [pauseWake]);

  const beginListening = useCallback(() => {
    if (recorderRef.current || !canVoice) return;
    pauseWake(true);
    void startRecording()
      .then((h) => {
        recorderRef.current = h;
        setPhase("listening");
      })
      .catch(() => setPhase("idle"));
  }, [canVoice, pauseWake]);

  const stopAndSend = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setPhase("thinking");
    void (async () => {
      try {
        const { audio, mimeType } = await rec.stop();
        const res = await window.praxis.processAudio({ audio, mimeType, projectId });
        await handleResult(res);
      } catch (err) {
        setLines((l) => [...l, { who: "praxis", text: `Something went wrong: ${(err as Error).message}` }]);
        setPhase("idle");
        pauseWake(false);
      }
    })();
  }, [handleResult, projectId, pauseWake]);

  const sendTyped = useCallback(() => {
    const text = typed.trim();
    if (!text) return;
    setTyped("");
    setPhase("thinking");
    pauseWake(true);
    void (async () => {
      try {
        const res = await window.praxis.processText({ text, projectId });
        await handleResult(res);
      } catch (err) {
        setLines((l) => [...l, { who: "praxis", text: `Error: ${(err as Error).message}` }]);
        setPhase("idle");
        pauseWake(false);
      }
    })();
  }, [typed, handleResult, projectId, pauseWake]);

  // Wake word: always-listening loop, enabled by the HANDS-FREE toggle (or the
  // explicit wakeWord flag). On wake we acknowledge, then record hands-free
  // until you stop talking. Say "Praxis…" or "Hey Praxis, wake up".
  useEffect(() => {
    if (!(handsFree || wakeWord) || !canVoice) return;
    let cancelled = false;
    void startWakeLoop({
      onWake: async (heard) => {
        if (cancelled) return;
        wakeRef.current?.setPaused(true);
        setLines((l) => [
          ...l,
          { who: "praxis", text: "Yes, Sir? I'm listening.", tag: `woke on “${heard.trim()}”` },
        ]);
        setPhase("listening");
        try {
          const clip = await recordCommand({});
          setPhase("thinking");
          const res = await window.praxis.processAudio({ ...clip, projectId });
          await handleResult(res);
        } catch {
          setPhase("idle");
        }
        // handleResult resumes the loop; make sure a failed capture does too.
        wakeRef.current?.setPaused(false);
      },
    })
      .then((h) => {
        if (cancelled) h.stop();
        else wakeRef.current = h;
      })
      .catch(() => setHandsFree(false));
    return () => {
      cancelled = true;
      wakeRef.current?.stop();
      wakeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handsFree, wakeWord, canVoice, projectId]);

  // Push-to-talk: hold Space to record, release to send (ignored while typing).
  useEffect(() => {
    if (!bindPushToTalk || !canVoice) return;
    const typing = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent): void => {
      if (e.code !== "Space" || e.repeat || typing(e.target)) return;
      e.preventDefault();
      beginListening();
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code !== "Space" || typing(e.target)) return;
      e.preventDefault();
      if (recorderRef.current) stopAndSend();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [bindPushToTalk, canVoice, beginListening, stopAndSend]);

  return {
    phase,
    lines,
    status,
    handsFree,
    setHandsFree,
    wakeWord,
    setWakeWord,
    typed,
    setTyped,
    beginListening,
    stopAndSend,
    sendTyped,
    hasRecorder: () => recorderRef.current != null,
  };
}
