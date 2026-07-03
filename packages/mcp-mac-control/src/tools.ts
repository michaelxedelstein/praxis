/**
 * Mac automation tools, each implemented with AppleScript/JXA via `osascript`
 * or small shell utilities. macOS will prompt for Automation permission the
 * first time each target app is scripted; iMessage READING additionally needs
 * Full Disk Access (it reads ~/Library/Messages/chat.db).
 */
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const TIMEOUT = 15_000;

export interface MacToolResult {
  text: string;
  isError?: boolean;
}

async function osascript(script: string): Promise<string> {
  const { stdout } = await run("osascript", ["-e", script], { timeout: TIMEOUT });
  return stdout.trim();
}

/** Quote a string for safe embedding inside an AppleScript string literal. */
function q(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const BROWSER_APPS: Record<string, string> = {
  chrome: "Google Chrome",
  safari: "Safari",
  shift: "Shift",
  arc: "Arc",
  firefox: "Firefox",
};

/* --------------------------------- browser -------------------------------- */

export async function openUrl(url: string, browser?: string): Promise<MacToolResult> {
  if (!/^https?:\/\//i.test(url)) return { text: "Only http(s) URLs are allowed.", isError: true };
  if (browser) {
    const app = BROWSER_APPS[browser.toLowerCase()] ?? browser;
    await run("open", ["-a", app, url], { timeout: TIMEOUT });
    return { text: `Opened ${url} in ${app}.` };
  }
  await run("open", [url], { timeout: TIMEOUT });
  return { text: `Opened ${url} in the default browser.` };
}

export async function listBrowserTabs(browser = "chrome"): Promise<MacToolResult> {
  const name = browser.toLowerCase();
  if (name === "chrome") {
    const out = await osascript(
      `tell application "Google Chrome"
         set acc to ""
         repeat with w in windows
           repeat with t in tabs of w
             set acc to acc & (title of t) & " — " & (URL of t) & linefeed
           end repeat
         end repeat
         return acc
       end tell`,
    );
    return { text: out || "No Chrome tabs open." };
  }
  if (name === "safari") {
    const out = await osascript(
      `tell application "Safari"
         set acc to ""
         repeat with w in windows
           repeat with t in tabs of w
             set acc to acc & (name of t) & " — " & (URL of t) & linefeed
           end repeat
         end repeat
         return acc
       end tell`,
    );
    return { text: out || "No Safari tabs open." };
  }
  return { text: `Tab listing works for Chrome and Safari; ${browser} isn't scriptable.`, isError: true };
}

/* --------------------------------- finder --------------------------------- */

function resolvePath(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

export async function finderReveal(path: string): Promise<MacToolResult> {
  await run("open", ["-R", resolvePath(path)], { timeout: TIMEOUT });
  return { text: `Revealed ${path} in Finder.` };
}

export async function finderOpen(path: string): Promise<MacToolResult> {
  await run("open", [resolvePath(path)], { timeout: TIMEOUT });
  return { text: `Opened ${path}.` };
}

export async function finderNewFolder(path: string): Promise<MacToolResult> {
  await run("mkdir", ["-p", resolvePath(path)], { timeout: TIMEOUT });
  return { text: `Created folder ${path}.` };
}

export async function finderTrash(path: string): Promise<MacToolResult> {
  // Move to Trash via Finder (recoverable), never rm.
  await osascript(
    `tell application "Finder" to delete (POSIX file ${q(resolvePath(path))} as alias)`,
  );
  return { text: `Moved ${path} to the Trash (recoverable).` };
}

/* -------------------------------- iMessage -------------------------------- */

export async function imessageSend(to: string, message: string): Promise<MacToolResult> {
  await osascript(
    `tell application "Messages"
       set targetService to 1st account whose service type = iMessage
       set targetBuddy to participant ${q(to)} of targetService
       send ${q(message)} to targetBuddy
     end tell`,
  );
  return { text: `Sent iMessage to ${to}.` };
}

/** Reads recent messages from chat.db — requires Full Disk Access. */
export async function imessageRecent(limit = 10): Promise<MacToolResult> {
  const db = join(homedir(), "Library", "Messages", "chat.db");
  const sql = `SELECT datetime(m.date/1000000000 + strftime('%s','2001-01-01'),'unixepoch','localtime') as at,
       coalesce(h.id,'me') as who, substr(coalesce(m.text,''),1,200) as body
     FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID
     WHERE m.text IS NOT NULL ORDER BY m.date DESC LIMIT ${Math.min(Math.max(limit, 1), 50)};`;
  try {
    const { stdout } = await run("sqlite3", ["-readonly", "-separator", " | ", db, sql], {
      timeout: TIMEOUT,
    });
    return { text: stdout.trim() || "No recent messages found." };
  } catch (err) {
    const msg = (err as Error).message;
    if (/unable to open|authorization denied|operation not permitted/i.test(msg)) {
      return {
        text:
          "Can't read Messages — grant Full Disk Access to Praxis in System Settings → Privacy & Security → Full Disk Access.",
        isError: true,
      };
    }
    return { text: `Failed to read messages: ${msg}`, isError: true };
  }
}

/* ------------------------------ apps + system ----------------------------- */

export async function appFocus(name: string): Promise<MacToolResult> {
  await osascript(`tell application ${q(name)} to activate`);
  return { text: `Focused ${name}.` };
}

export async function clipboardGet(): Promise<MacToolResult> {
  const { stdout } = await run("pbpaste", [], { timeout: TIMEOUT });
  return { text: stdout.slice(0, 4000) || "(clipboard is empty)" };
}

export async function clipboardSet(text: string): Promise<MacToolResult> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile("pbcopy", (err) => (err ? reject(err) : resolve()));
    child.stdin?.end(text);
  });
  return { text: "Copied to clipboard." };
}

export async function notify(title: string, message: string): Promise<MacToolResult> {
  await osascript(`display notification ${q(message)} with title ${q(title)}`);
  return { text: "Notification shown." };
}
