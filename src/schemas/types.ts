/**
 * 定义工作流 schema 中的单个产物（artifact）。
 */
export interface ArtifactDef {
  id: string;
  generates: string;
  requires: string[];
  template?: string;
  instruction?: string;
  instructionFile?: string;
  contextBudget?: number;
  validation?: {
    mechanical?: string[];
    semantic?: string[];
  };
}

export type ArtifactStatus = "blocked" | "ready" | "done";

/**
 * Schema 定义，描述整个工作流的结构、产物和 apply 规则。
 */
export interface SchemaDef {
  name: string;
  version: number;
  description?: string;
  context?: Record<string, string>;
  artifacts: ArtifactDef[];
  apply?: {
    requires: string[];
    target: string;
    action?: "copy" | "move";
  };
}

/**
 * 单次变更（change）的清单文件 `.openadab.yaml` 结构。
 */
export interface ChangeManifest {
  changeId: string;
  schema: string;
  version: number;
  created: string;
  status: "in_progress" | "synced" | "archived";
  currentArtifact?: string;
  artifacts: Record<string, ArtifactStatus>;
  chapter?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Wiki 页面结构（由 gray-matter 解析得到）。
 */
export interface WikiPage {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * 上下文打包结果，包含必须阅读、可选阅读和排除的文件列表及其原因。
 */
export interface ContextPack {
  mustRead: string[];
  optionalRead: string[];
  excluded: string[];
  reasons: Record<string, string>;
}

export interface WikiDiffOperationBase {
  type: string;
  target: string;
  source: string;
}

export interface WikiDiffAddCurrentState extends WikiDiffOperationBase {
  type: "add_current_state";
  content: string;
}

export interface WikiDiffAddKnowledgeTimeline extends WikiDiffOperationBase {
  type: "add_knowledge_timeline";
  chapter: string;
  knowledge: string;
}

export interface WikiDiffUpdateRelationship extends WikiDiffOperationBase {
  type: "update_relationship";
  relatedEntity: string;
  relationship: string;
}

/**
 * 更新线索（thread）状态。
 */
export interface WikiDiffUpdateThreadStatus extends WikiDiffOperationBase {
  type: "update_thread_status";
  status: "open" | "advanced" | "resolved";
  evidence?: string[];
}

export interface WikiDiffAddEvidence extends WikiDiffOperationBase {
  type: "add_evidence";
  evidence: string;
}

export interface WikiDiffFlagContradiction extends WikiDiffOperationBase {
  type: "flag_contradiction";
  description: string;
  sources: { page: string; claim: string }[];
  status: "unresolved" | "explained" | "retconned";
}

/**
 * 更新 frontmatter 字段。
 */
export interface WikiDiffUpdateField extends WikiDiffOperationBase {
  type: "update_field";
  field: string;
  value: unknown;
}

export type WikiDiffOperation =
  | WikiDiffAddCurrentState
  | WikiDiffAddKnowledgeTimeline
  | WikiDiffUpdateRelationship
  | WikiDiffUpdateThreadStatus
  | WikiDiffAddEvidence
  | WikiDiffFlagContradiction
  | WikiDiffUpdateField;

export interface WikiDiffDocument {
  changeId: string;
  operations: WikiDiffOperation[];
}

export interface ValidationResult {
  artifactId: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
  extras?: Record<string, unknown>;
}

/**
 * 项目配置结构（adab/config.yaml）。
 */
export interface ProjectConfig {
  [key: string]: unknown;
  schema: string;
  version: number;
  project: {
    title: string;
    language: "zh-CN" | "en-US" | "ja-JP";
    genre: string;
    tense: "past" | "present";
    pov: "first-person" | "limited-third" | "omniscient-third";
  };
  context: {
    maxTokens: number;
    alwaysInclude: string[];
    tokenHeuristic: "chars-per-token";
    excludePatterns: string[];
  };
  rules: Record<string, string[]>;
  archive: {
    backupOnOverwrite: boolean;
  };
}

export interface LogEntry {
  ts: string;
  op: string;
  change?: string | null;
  result: string;
  details?: Record<string, unknown>;
}
