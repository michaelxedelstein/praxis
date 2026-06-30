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

export async function startRecording(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

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

/** Play an mp3 returned as base64; resolves when playback finishes. */
export function playMp3Base64(base64: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    void audio.play().catch(() => resolve());
  });
}
