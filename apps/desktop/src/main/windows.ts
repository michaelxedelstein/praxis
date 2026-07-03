/**
 * WindowManager — owns the main window and the multi-monitor "expand" feature.
 *
 * Collapsed: one window showing the full dashboard (hive + side panels).
 * Expanded: the main window (hive) stays on its display and satellite windows
 * open on the OTHER displays — one for the active conversation, one for the
 * task board — so the workspace spreads across 2-3 screens like a command deck.
 *
 * Each window loads the same renderer bundle with a `?view=` query param that
 * tells the React app which surface to render.
 */
import { join } from "node:path";
import { BrowserWindow, screen } from "electron";
import type { DisplayInfo, LayoutMode, WindowView } from "../shared/ipc.js";

const PRELOAD = () => join(__dirname, "../preload/index.mjs");

function loadView(win: BrowserWindow, view: WindowView): void {
  const q = `view=${view}`;
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${q}`);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"), { search: q });
  }
}

export class WindowManager {
  private main: BrowserWindow | null = null;
  private satellites: BrowserWindow[] = [];
  private layout: LayoutMode = "collapsed";
  private readonly onLayout: (info: DisplayInfo) => void;

  constructor(opts: { onLayout: (info: DisplayInfo) => void }) {
    this.onLayout = opts.onLayout;
  }

  mainWindow(): BrowserWindow | null {
    return this.main;
  }

  ensureMain(): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) return this.main;
    this.main = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: "Praxis",
      backgroundColor: "#05070d",
      webPreferences: {
        preload: PRELOAD(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    loadView(this.main, "hive");
    this.main.on("ready-to-show", () => this.main?.show());
    this.main.on("closed", () => (this.main = null));
    return this.main;
  }

  info(): DisplayInfo {
    return { displayCount: screen.getAllDisplays().length, layout: this.layout };
  }

  /** Spread across / collapse back from multiple monitors. */
  setLayout(mode: LayoutMode): DisplayInfo {
    if (mode === this.layout) return this.info();
    this.layout = mode;
    if (mode === "expanded") this.expand();
    else this.collapse();
    const info = this.info();
    this.onLayout(info);
    return info;
  }

  private expand(): void {
    const main = this.ensureMain();
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const others = displays.filter((d) => d.id !== primary.id);

    // Main (hive) fills the primary display.
    main.setBounds(primary.workArea);

    // One satellite per remaining display, alternating views.
    const views: WindowView[] = ["conversation", "tasks"];
    others.forEach((display, i) => {
      const win = new BrowserWindow({
        ...display.workArea,
        show: false,
        title: "Praxis",
        backgroundColor: "#05070d",
        webPreferences: {
          preload: PRELOAD(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      loadView(win, views[i % views.length] ?? "tasks");
      win.on("ready-to-show", () => win.show());
      win.on("closed", () => {
        this.satellites = this.satellites.filter((w) => w !== win);
      });
      this.satellites.push(win);
    });

    // Single-monitor fallback: no satellites, just maximize the main window.
    if (others.length === 0) main.maximize();
  }

  private collapse(): void {
    for (const win of this.satellites) if (!win.isDestroyed()) win.close();
    this.satellites = [];
    const main = this.ensureMain();
    if (main.isMaximized()) main.unmaximize();
    main.setSize(1280, 820);
    main.center();
  }

  broadcast(channel: string, payload: unknown): void {
    for (const win of [this.main, ...this.satellites]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  closeAll(): void {
    for (const win of this.satellites) if (!win.isDestroyed()) win.close();
    this.satellites = [];
  }
}
