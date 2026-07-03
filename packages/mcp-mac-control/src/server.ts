#!/usr/bin/env node
/**
 * praxis-mac-control — an MCP server (stdio) exposing controlled macOS
 * automation: browser, Finder, iMessage, app focus, clipboard, notifications.
 *
 * Shipping this as an MCP server (rather than desktop-internal code) means the
 * SAME tools are available to the main brain, sub-agents, and even the headless
 * relay if it ever runs on a Mac. Destructive tools are marked in DESTRUCTIVE_TOOLS
 * so hosts can require user confirmation before invoking them.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  appFocus,
  clipboardGet,
  clipboardSet,
  finderNewFolder,
  finderOpen,
  finderReveal,
  finderTrash,
  imessageRecent,
  imessageSend,
  listBrowserTabs,
  notify,
  openUrl,
  type MacToolResult,
} from "./tools.js";
import { DESTRUCTIVE_TOOLS } from "./index.js";

function toContent(r: MacToolResult): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
}

async function main(): Promise<void> {
  const server = new McpServer({ name: "praxis-mac-control", version: "0.1.0" });

  server.registerTool(
    "open_url",
    {
      description:
        "Open a URL in the user's default browser, or a named one (chrome, safari, shift, arc, firefox).",
      inputSchema: {
        url: z.string().describe("http(s) URL to open"),
        browser: z.string().optional().describe("Browser name; omit for the default browser"),
      },
    },
    async ({ url, browser }) => toContent(await openUrl(url, browser)),
  );

  server.registerTool(
    "list_browser_tabs",
    {
      description: "List open tabs (title + URL) in Chrome or Safari.",
      inputSchema: {
        browser: z.string().optional().describe("'chrome' (default) or 'safari'"),
      },
    },
    async ({ browser }) => toContent(await listBrowserTabs(browser ?? "chrome")),
  );

  server.registerTool(
    "finder_reveal",
    {
      description: "Reveal a file or folder in Finder.",
      inputSchema: { path: z.string().describe("Absolute or ~-relative path") },
    },
    async ({ path }) => toContent(await finderReveal(path)),
  );

  server.registerTool(
    "finder_open",
    {
      description: "Open a file or folder with its default application.",
      inputSchema: { path: z.string().describe("Absolute or ~-relative path") },
    },
    async ({ path }) => toContent(await finderOpen(path)),
  );

  server.registerTool(
    "finder_new_folder",
    {
      description: "Create a folder (like mkdir -p).",
      inputSchema: { path: z.string().describe("Absolute or ~-relative path") },
    },
    async ({ path }) => toContent(await finderNewFolder(path)),
  );

  server.registerTool(
    "finder_trash",
    {
      description:
        "Move a file or folder to the Trash (recoverable). DESTRUCTIVE — hosts should confirm with the user first.",
      inputSchema: { path: z.string().describe("Absolute or ~-relative path") },
    },
    async ({ path }) => toContent(await finderTrash(path)),
  );

  server.registerTool(
    "imessage_send",
    {
      description:
        "Send an iMessage via Messages.app. DESTRUCTIVE (visible to the recipient) — hosts should confirm with the user first.",
      inputSchema: {
        to: z.string().describe("Phone number or Apple ID email of the recipient"),
        message: z.string().describe("Message text to send"),
      },
    },
    async ({ to, message }) => toContent(await imessageSend(to, message)),
  );

  server.registerTool(
    "imessage_recent",
    {
      description:
        "Read the most recent iMessages (requires Full Disk Access granted to the host app).",
      inputSchema: {
        limit: z.number().optional().describe("How many messages (default 10, max 50)"),
      },
    },
    async ({ limit }) => toContent(await imessageRecent(limit ?? 10)),
  );

  server.registerTool(
    "app_focus",
    {
      description: "Bring a macOS application to the foreground by name.",
      inputSchema: { name: z.string().describe("Application name, e.g. 'Cursor'") },
    },
    async ({ name }) => toContent(await appFocus(name)),
  );

  server.registerTool(
    "clipboard_get",
    { description: "Read the current clipboard text.", inputSchema: {} },
    async () => toContent(await clipboardGet()),
  );

  server.registerTool(
    "clipboard_set",
    {
      description: "Put text on the clipboard.",
      inputSchema: { text: z.string().describe("Text to copy") },
    },
    async ({ text }) => toContent(await clipboardSet(text)),
  );

  server.registerTool(
    "notify",
    {
      description: "Show a macOS notification.",
      inputSchema: {
        title: z.string().describe("Notification title"),
        message: z.string().describe("Notification body"),
      },
    },
    async ({ title, message }) => toContent(await notify(title, message)),
  );

  // Advertised so hosts can discover which tools need a confirm step.
  void DESTRUCTIVE_TOOLS;

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("mac-control server failed:", err);
  process.exit(1);
});
