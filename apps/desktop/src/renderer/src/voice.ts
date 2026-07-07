/**
 * Renderer-side mic capture. The renderer only records audio and plays it back;
 * transcription and synthesis happen in the main process (keeping the API key
 * out of here). Returns a recorder handle whose `stop()` resolves with the clip.
 */
export interface RecorderHandle {
  stop: () => Promise<{ audio: ArrayBuffer; mimeType: string }>;
  cancel: () => void;
}

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
}

/** Virtual/loopback devices that produce silence unless something routes audio
 *  into them. If one of these is the system default (e.g. BlackHole), recording
 *  from it captures nothing — so we always pick a real microphone instead. */
const VIRTUAL_DEVICE = /blackhole|loopback|soundflower|aggregate|multi-output|virtual|jump desktop/i;

export async function pickMicDeviceId(): Promise<string | undefined> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "default");
  const real = inputs.filter((d) => d.label && !VIRTUAL_DEVICE.test(d.label));
  const preferred =
    real.find((d) => /usb|built-in|macbook|external/i.test(d.label)) ?? real[0] ?? inputs[0];
  return preferred?.deviceId;
}

export async function openMicStream(): Promise<MediaStream> {
  const deviceId = await pickMicDeviceId();
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

export async function startRecording(): Promise<RecorderHandle> {
  const stream = await openMicStream();
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  // Flush a chunk every 250ms so the clip always has data even for short holds
  // (some Chromium builds emit nothing until stop() otherwise).
  recorder.start(250);

  const cleanup = (): void => {
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: mimeType });
          const audio = await blob.arrayBuffer();
          cleanup();
          resolve({ audio, mimeType });
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
      cleanup();
    },
  };
}

/**
 * Hands-free command capture: record until the speaker goes quiet (or maxMs).
 * Used right after a wake word so the user can just talk and stop naturally.
 */
export async function recordCommand(
  opts: { maxMs?: number; silenceMs?: number } = {},
): Promise<{ audio: ArrayBuffer; mimeType: string }> {
  const maxMs = opts.maxMs ?? 12000;
  const silenceMs = opts.silenceMs ?? 1400;
  const stream = await openMicStream();
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const level = (): number => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += (buf[i] ?? 0) * (buf[i] ?? 0);
    return Math.sqrt(sum / buf.length);
  };

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve) => {
    const SPEECH_RMS = 0.012;
    let heardSpeech = false;
    let lastLoud = Date.now();
    const startedAt = Date.now();

    const meter = setInterval(() => {
      if (level() > SPEECH_RMS) {
        heardSpeech = true;
        lastLoud = Date.now();
      }
      const quietLongEnough = heardSpeech && Date.now() - lastLoud > silenceMs;
      const tooLong = Date.now() - startedAt > maxMs;
      if ((quietLongEnough || tooLong) && recorder.state !== "inactive") recorder.stop();
    }, 100);

    recorder.onstop = async () => {
      clearInterval(meter);
      for (const track of stream.getTracks()) track.stop();
      void ctx.close();
      const blob = new Blob(chunks, { type: mimeType });
      resolve({ audio: await blob.arrayBuffer(), mimeType });
    };
    recorder.start(250);
  });
}

/* --------------------------------- wake word -------------------------------- */

export interface WakeLoopHandle {
  stop: () => void;
  /** Pause clip capture (e.g. while a real conversation turn is recording). */
  setPaused: (paused: boolean) => void;
}

/**
 * Always-on wake-word loop. Keeps one mic stream open with a local level
 * meter; only when it hears speech-level audio does it record a short clip and
 * ask the main process whether it contained a wake phrase ("Hey Jarvis").
 * Silence never leaves the machine.
 */
export async function startWakeLoop(opts: {
  onWake: (heard: string) => void;
  onState?: (state: "listening" | "checking") => void;
}): Promise<WakeLoopHandle> {
  const stream = await openMicStream();
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  let stopped = false;
  let paused = false;
  let busy = false;

  const rms = (): number => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += (buf[i] ?? 0) * (buf[i] ?? 0);
    return Math.sqrt(sum / buf.length);
  };

  const captureClip = (ms: number): Promise<{ audio: ArrayBuffer; mimeType: string }> =>
    new Promise((resolve, reject) => {
      const mimeType = pickMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType });
      } catch (err) {
        reject(err as Error);
        return;
      }
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mimeType });
        resolve({ audio: await blob.arrayBuffer(), mimeType });
      };
      recorder.start(250);
      setTimeout(() => recorder.state !== "inactive" && recorder.stop(), ms);
    });

  const SPEECH_RMS = 0.015; // roughly: talking anywhere in the room
  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (!paused && !busy && rms() > SPEECH_RMS) {
      busy = true;
      opts.onState?.("checking");
      try {
        const clip = await captureClip(2600);
        const res = await window.praxis.wakeCheck(clip);
        if (res.woke && !stopped) opts.onWake(res.heard);
      } catch {
        /* mic hiccup — keep listening */
      }
      busy = false;
      opts.onState?.("listening");
    }
    if (!stopped) setTimeout(() => void tick(), 180);
  };
  opts.onState?.("listening");
  void tick();

  return {
    stop: () => {
      stopped = true;
      for (const track of stream.getTracks()) track.stop();
      void ctx.close();
    },
    setPaused: (p: boolean) => {
      paused = p;
    },
  };
}

/** Play an mp3 returned as base64; resolves when playback finishes. */
export function playMp3Base64(base64: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    void audio.play().catch(() => resolve());
  });
}

/**
 * Sequential speech queue. Live status narration and the final reply are both
 * pushed here so clips always play one after another in order, never on top of
 * each other. `onActive` fires when playback starts/stops so the UI can reflect
 * the "speaking" phase.
 */
let speechChain: Promise<void> = Promise.resolve();
let speechDepth = 0;
let onSpeechActive: ((active: boolean) => void) | null = null;

export function setSpeechActiveHandler(cb: ((active: boolean) => void) | null): void {
  onSpeechActive = cb;
}

export function queueSpeech(base64: string): Promise<void> {
  speechDepth += 1;
  onSpeechActive?.(true);
  speechChain = speechChain
    .then(() => playMp3Base64(base64))
    .finally(() => {
      speechDepth -= 1;
      if (speechDepth === 0) onSpeechActive?.(false);
    });
  return speechChain;
}
