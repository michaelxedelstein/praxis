import { describe, it, expect, vi, afterEach } from "vitest";
import { ElevenLabsClient } from "./client.js";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

describe("ElevenLabsClient", () => {
  it("sends the api key and returns the transcript", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "hello there" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new ElevenLabsClient({ apiKey: "key123" });
    const text = await client.transcribe({ audio: new Uint8Array([1, 2, 3]) });

    expect(text).toBe("hello there");
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ "xi-api-key": "key123" });
  });

  it("mints a conversation token without leaking the key downstream", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: "tok_abc" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new ElevenLabsClient({ apiKey: "secret" });
    const res = await client.mintConversationToken("agent_1");

    expect(res.token).toBe("tok_abc");
    expect(res.agentId).toBe("agent_1");
    expect(res.token).not.toContain("secret");
  });

  it("throws a helpful error on non-2xx", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const client = new ElevenLabsClient({ apiKey: "bad" });
    await expect(client.mintConversationToken("a")).rejects.toThrow(/401/);
  });
});
