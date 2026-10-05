export type View =
  "studio" | "projects" | "voices" | "directions" | "tasks" | "settings";
export type InstallKind = "uv" | "python" | "dependencies" | "model";
export type ResourceStatus =
  "missing" | "ready" | "busy" | "error" | "cancelled";
export interface Resource {
  status: ResourceStatus;
  stage: string;
  progress: number | null;
  downloaded?: number;
  total?: number;
  error?: string;
  version?: string;
  path: string;
}
export interface Runtime {
  root: string;
  uv: Resource;
  python: Resource;
  dependencies: Resource;
  model: Resource;
  service: {
    status: "stopped" | "starting" | "running" | "stopping" | "error";
    message: string;
    error?: string;
  };
  busy: InstallKind | null;
  logs: string[];
}
export interface Voice {
  id: string;
  name: string;
  kind: "design" | "reference";
  description: string;
  seed: number;
  assetId?: string;
  transcript?: string;
  consent?: boolean;
}
export interface Direction {
  id: string;
  name: string;
  instruction: string;
}
export interface Segment {
  id: string;
  name: string;
  text: string;
  language: "zh" | "en";
  voiceSource: "library" | "description";
  voiceId: string;
  voiceDescription: string;
  directionEnabled: boolean;
  directionSource: "description" | "preset";
  directionDraft: string;
  directionPresetId: string;
  seed: number;
  cfg: number;
  count: number;
}
export interface Project {
  id: string;
  title: string;
  segments: Segment[];
  currentId: string;
  updatedAt: number;
}
export interface FixedInput {
  text: string;
  language: "zh" | "en";
  instruction: string;
  voiceName: string;
  reference?: { assetId: string; transcript: string; name: string };
  cfg: number;
  seed: number;
  signature: string;
  model: string;
}
export interface Unit {
  id: string;
  segmentId: string;
  segmentName: string;
  index: number;
  input: FixedInput;
  outputId: string | null;
}
export type TaskStatus =
  | "queued"
  | "preparing"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";
export interface Task {
  cancelRequested?: boolean;
  id: string;
  projectId: string;
  projectTitle: string;
  createdAt: number;
  status: TaskStatus;
  attempts: number;
  units: Unit[];
  error: string | null;
  events: { at: number; message: string }[];
  stream?: { file: string; sampleRate: number; bytes: number };
}
export interface Output {
  candidateSeed?: number;
  id: string;
  taskId: string;
  projectId: string;
  segmentId: string;
  name: string;
  createdAt: number;
  file: string;
  duration: number;
  input: FixedInput;
  feedback: string;
  truncated: boolean;
}
export interface Workspace {
  schemaVersion: 1;
  revision: number;
  currentProjectId: string;
  projects: Project[];
  voices: Voice[];
  directions: Direction[];
  tasks: Task[];
  outputs: Output[];
}
export interface Snapshot {
  workspace: Workspace;
  runtime: Runtime;
}
export interface Command {
  type: string;
  id?: string;
  projectId?: string;
  segmentId?: string;
  patch?: Record<string, unknown>;
  item?: unknown;
  all?: boolean;
  value?: unknown;
}
export interface DesktopBridge {
  onBeforeClose(handler: () => Promise<boolean>): () => void;
  pickReference(): Promise<{ name: string; bytes: number[] } | null>;
  openFolder(kind: "data" | "models" | "root"): Promise<void>;
  saveAudio(id: string): Promise<AudioSaveResult>;
}
export type AudioSaveResult =
  { status: "saved"; name: string } | { status: "cancelled" };
declare global {
  interface Window {
    breeze?: DesktopBridge;
  }
}
export interface InstallPlan {
  kind: InstallKind;
  valid: boolean;
  reason?: string;
  blockers: InstallKind[];
}
export interface Waveform {
  duration: number;
  peaks: number[];
  peak: number;
}
