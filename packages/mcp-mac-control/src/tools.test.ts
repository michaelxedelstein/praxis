import { describe, expect, it } from "vitest";
import { openUrl } from "./tools.js";
import { DESTRUCTIVE_TOOLS, serverEntryPath } from "./index.js";

describe("openUrl", () => {
  it("rejects non-http(s) schemes without shelling out", async () => {
    const res = await openUrl("file:///etc/passwd");
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/http/i);
  });

  it("rejects javascript: URLs", async () => {
    const res = await openUrl("javascript:alert(1)");
    expect(res.isError).toBe(true);
  });
});

describe("metadata", () => {
  it("marks the visibly-destructive tools for host confirmation", () => {
    expect(DESTRUCTIVE_TOOLS.has("finder_trash")).toBe(true);
    expect(DESTRUCTIVE_TOOLS.has("imessage_send")).toBe(true);
    expect(DESTRUCTIVE_TOOLS.has("clipboard_get")).toBe(false);
  });

  it("resolves the built server entry path", () => {
    expect(serverEntryPath()).toMatch(/server\.js$/);
  });
});
