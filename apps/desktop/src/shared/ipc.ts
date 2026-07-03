/**
 * IPC contract shared between the Electron main process and the renderer. Kept
 * in one place so both sides stay in sync. The brain runs in MAIN; the renderer
 * only captures the mic, plays audio, and draws the hive — so no API key ever
 * reaches the renderer.
 */
import type { DispatchResult, TaskMode, TurnResult } from "@praxis/shared-types";

export const IPC = {
  // Conversation
  processAudio: "praxis:processAudio",
  processText: "praxis:processText",
  getStatus: "praxis:getStatus",
  statusUpdated: "praxis:statusUpdated",
  summon: "praxis:summon",
  turnStatus: "praxis:turnStatus",
  // Voice settings
  getVoices: "praxis:getVoices",
  setVoiceConfig: "praxis:setVoiceConfig",
  // Project graph
  listProjects: "praxis:listProjects",
  refreshProjects: "praxis:refreshProjects",
  getProjectDetail: "praxis:getProjectDetail",
  projectsUpdated: "praxis:projectsUpdated",
  // Repo actions + task dispatch
  projectAction: "praxis:projectAction",
  dispatchTask: "praxis:dispatchTask",
  listTasks: "praxis:listTasks",
  tasksUpdated: "praxis:tasksUpdated",
  // Tool palette
  listTools: "praxis:listTools",
  runTool: "praxis:runTool",
  // MCP connections (importer + connect cards)
  listMcpConnections: "praxis:listMcpConnections",
  saveMcpConnection: "praxis:saveMcpConnection",
  // Sub-agents (conductor)
  listAgents: "praxis:listAgents",
  agentsUpdated: "praxis:agentsUpdated",
  confirmRequest: "praxis:confirmRequest",
  confirmResolve: "praxis:confirmResolve",
  // Multi-monitor
  getDisplayInfo: "praxis:getDisplayInfo",
  setLayout: "praxis:setLayout",
  layoutChanged: "praxis:layoutChanged",
} as const;

/* ------------------------------ conversation ------------------------------ */

/** Renderer → main: an audio clip to transcribe + answer + speak. */
export interface ProcessAudioRequest {
  /** Raw audio bytes (e.g. webm/opus from MediaRecorder). */
  audio: ArrayBuffer;
  mimeType: string;
  /** Scope the turn to a project session (node id); omit for the global HUD. */
  projectId?: string;
}

/** Renderer → main: a typed utterance (no STT needed). */
export interface ProcessTextRequest {
  text: string;
  projectId?: string;
}

/** Main → renderer: the full result of a turn. */
export interface ProcessResult {
  /** What we heard (empty for typed input). */
  userText: string;
  result: TurnResult;
  /** base64-encoded mp3 of the spoken reply, or null if TTS unavailable. */
  audioBase64: string | null;
}

/** Main → renderer (push): live loop progress ("thinking", "calling tool…"). */
export interface TurnStatusEvent {
  projectId?: string;
  detail: string;
}

export interface PraxisStatus {
  brainReady: boolean;
  hasVoice: boolean;
  hasDispatch: boolean;
  userName: string;
  toolCount: number;
}

/* ------------------------------ voice settings ---------------------------- */

/** One selectable ElevenLabs voice. */
export interface VoiceOption {
  voiceId: string;
  name: string;
  category?: string;
}

/** Renderer → main: save an ElevenLabs key (and optional voice) at runtime. */
export interface SetVoiceConfigRequest {
  apiKey: string;
  voiceId?: string;
}

/** Main → renderer: result of saving voice config. */
export interface SetVoiceConfigResult {
  ok: boolean;
  hasVoice: boolean;
  /** Chosen voice name when successful. */
  voiceName?: string;
  /** Friendly error when it failed (e.g. bad key). */
  detail?: string;
}

/* ------------------------------ project graph ----------------------------- */

export type ProjectKind = "local" | "github";

export interface ProjectGitHubInfo {
  fullName: string;
  url: string;
  description?: string;
  stars?: number;
  isPrivate?: boolean;
  pushedAt?: number;
}

export interface ProjectNode {
  /** "local:<folder>" or "gh:<owner>/<repo>". */
  id: string;
  name: string;
  kind: ProjectKind;
  /** Absolute folder path (local projects only). */
  path?: string;
  branch?: string;
  dirty?: boolean;
  /** Normalized origin URL, used to merge local+GitHub entries. */
  remoteUrl?: string;
  language?: string;
  /** Unix ms of last commit/push — drives node brightness. */
  lastActivity?: number;
  lastCommit?: string;
  /** Present when the project is (also) on GitHub. */
  github?: ProjectGitHubInfo;
}

export interface ProjectLink {
  source: string;
  target: string;
  kind: "language" | "owner";
  label?: string;
}

export interface ProjectGraph {
  nodes: ProjectNode[];
  links: ProjectLink[];
  updatedAt: number;
}

export interface ProjectCommit {
  hash: string;
  date: number;
  author: string;
  subject: string;
}

export interface ProjectDetail {
  node: ProjectNode;
  commits: ProjectCommit[];
  fileTree: string[];
  readme?: string;
}

/* --------------------------- actions + task board ------------------------- */

export type ProjectActionKind = "openInCursor" | "revealInFinder" | "openGitHub";

export interface ProjectActionRequest {
  id: string;
  action: ProjectActionKind;
}

export interface DispatchTaskRequest {
  /** Short project name (the #proj-<name> convention). */
  project: string;
  instruction: string;
  mode?: TaskMode;
}

export type TaskStatus = "dispatched" | "running" | "done" | "failed";

export interface TaskRecord {
  id: string;
  project: string;
  instruction: string;
  status: TaskStatus;
  source: "user" | "brain" | "subagent";
  createdAt: number;
  updatedAt: number;
  channelId?: string;
  messageTs?: string;
  detail?: string;
}

/* ------------------------------- tool palette ----------------------------- */

export interface ToolInfo {
  /** Namespaced name, e.g. "github__search_repositories". */
  name: string;
  description: string;
  /** JSON schema of the tool input (for the palette's arg form). */
  inputSchema: Record<string, unknown>;
}

export interface RunToolRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface RunToolResult {
  text: string;
  isError: boolean;
}

/* ----------------------------- MCP connections ---------------------------- */

/** A service the importer discovered (from Cursor config or plugin catalog). */
export interface McpConnectionInfo {
  id: string;
  title: string;
  /** Where it came from. */
  source: "cursor-config" | "plugin-catalog" | "praxis";
  /** Whether it's currently configured + connected into the brain. */
  status: "connected" | "needs-key" | "needs-auth" | "disabled" | "error";
  /** Env var names this connection needs (for the connect card form). */
  requiredEnv: string[];
  detail?: string;
}

export interface SaveMcpConnectionRequest {
  id: string;
  /** Secret values keyed by env var name; stored locally, never in the repo. */
  env: Record<string, string>;
  enabled: boolean;
}

/* -------------------------------- sub-agents ------------------------------ */

export type AgentStatus = "queued" | "running" | "done" | "failed";

export interface AgentTranscriptLine {
  role: "user" | "assistant" | "status";
  text: string;
  at: number;
}

export interface AgentRecord {
  id: string;
  title: string;
  /** Project node id the agent is scoped to, if any. */
  projectId?: string;
  status: AgentStatus;
  transcript: AgentTranscriptLine[];
  createdAt: number;
  updatedAt: number;
  result?: string;
}

/** Main → renderer (push): a destructive action needs the user's approval. */
export interface ConfirmRequestEvent {
  id: string;
  description: string;
}

export interface ConfirmResolveRequest {
  id: string;
  approved: boolean;
}

/* ------------------------------ multi-monitor ----------------------------- */

export type LayoutMode = "collapsed" | "expanded";

export interface DisplayInfo {
  displayCount: number;
  layout: LayoutMode;
}

/** Which view a satellite window renders (via ?view= query param). */
export type WindowView = "hive" | "conversation" | "tasks";

/* --------------------------------- bridge --------------------------------- */

/** The API surface exposed on `window.praxis` by the preload script. */
export interface PraxisBridge {
  processAudio(req: ProcessAudioRequest): Promise<ProcessResult>;
  processText(req: ProcessTextRequest): Promise<ProcessResult>;
  getStatus(): Promise<PraxisStatus>;
  /** Subscribe to live status changes (e.g. after enabling voice). */
  onStatusUpdated(cb: (s: PraxisStatus) => void): () => void;
  /** Subscribe to global-hotkey summons; returns an unsubscribe fn. */
  onSummon(cb: () => void): () => void;
  onTurnStatus(cb: (e: TurnStatusEvent) => void): () => void;

  /** List voices for a given (or already-saved) ElevenLabs key. */
  getVoices(apiKey?: string): Promise<VoiceOption[]>;
  /** Save an ElevenLabs key + voice at runtime; enables voice without a restart. */
  setVoiceConfig(req: SetVoiceConfigRequest): Promise<SetVoiceConfigResult>;

  listProjects(): Promise<ProjectGraph>;
  refreshProjects(): Promise<ProjectGraph>;
  getProjectDetail(id: string): Promise<ProjectDetail | null>;
  onProjectsUpdated(cb: (g: ProjectGraph) => void): () => void;

  projectAction(req: ProjectActionRequest): Promise<void>;
  dispatchTask(req: DispatchTaskRequest): Promise<DispatchResult>;
  listTasks(): Promise<TaskRecord[]>;
  onTasksUpdated(cb: (tasks: TaskRecord[]) => void): () => void;

  listTools(): Promise<ToolInfo[]>;
  runTool(req: RunToolRequest): Promise<RunToolResult>;

  listMcpConnections(): Promise<McpConnectionInfo[]>;
  saveMcpConnection(req: SaveMcpConnectionRequest): Promise<McpConnectionInfo[]>;

  listAgents(): Promise<AgentRecord[]>;
  onAgentsUpdated(cb: (agents: AgentRecord[]) => void): () => void;
  onConfirmRequest(cb: (e: ConfirmRequestEvent) => void): () => void;
  confirmResolve(req: ConfirmResolveRequest): Promise<void>;

  getDisplayInfo(): Promise<DisplayInfo>;
  setLayout(mode: LayoutMode): Promise<DisplayInfo>;
  onLayoutChanged(cb: (info: DisplayInfo) => void): () => void;
}
