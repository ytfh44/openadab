/**
 * SchemaWorkbench — main route for the Schemas workbench (Section 10).
 *
 * Composes:
 *   - SchemaList: installed schemas with active-schema highlighting
 *   - SchemaDetail: schema metadata + validation
 *   - SchemaDAG: artifact dependency graph visualization
 *   - SchemaForkDialog: modal for forking a schema
 *   - SchemaDiffView: side-by-side fork-vs-base comparison
 *   - YAML editor: plain textarea for raw YAML editing with validation rollback
 *
 * All data is fetched via `window.openadab.runCli()` and parsed from
 * CLI JSON output. No external UI or YAML libraries are used.
 *
 * Handles loading, empty, error, missing-project, and schema-management states.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  ProjectInfo,
  CommandEvent,
  FileReadResponse,
  FileWriteResponse,
} from '../../../shared/ipc-types.js';
import type {
  SchemaEntry,
  SchemaListResponse,
  SchemaDefinition,
  SchemaValidateResponse,
  SchemaForkResponse,
} from '../types/schema.js';
import SchemaList from '../components/SchemaList.js';
import SchemaDetail from '../components/SchemaDetail.js';
import SchemaDAG from '../components/SchemaDAG.js';
import SchemaForkDialog from '../components/SchemaForkDialog.js';
import SchemaDiffView from '../components/SchemaDiffView.js';

interface SchemaWorkbenchProps {
  /** Current project info, or null if no project is open. */
  projectInfo: ProjectInfo | null;
  /** Whether project info is still loading. */
  loading: boolean;
}

/** Generate a unique command ID for each CLI call. */
function genCommandId(): string {
  return crypto.randomUUID();
}

function projectPath(projectRoot: string, ...parts: string[]): string {
  const root = projectRoot.replace(/[/\\]+$/, '');
  return [root, ...parts.map((part) => part.replace(/^[/\\]+|[/\\]+$/g, ''))]
    .filter((part) => part.length > 0)
    .join('/');
}

function schemaDirPath(projectRoot: string, schemaName: string): string {
  return projectPath(projectRoot, 'adab', 'schemas', schemaName);
}

function schemaYamlPath(projectRoot: string, schemaName: string): string {
  return projectPath(projectRoot, 'adab', 'schemas', schemaName, 'schema.yaml');
}

/**
 * Parse the CLI schema list JSON output.
 *
 * Expected shape:
 *   { schemas: (string | { name, description?, version?, artifactCount?, builtin? })[], activeSchema?: string }
 */
function parseSchemaListResponse(parsed: unknown): SchemaListResponse | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj['schemas'])) return null;

  return {
    schemas: obj['schemas'] as (string | SchemaEntry)[],
    activeSchema:
      obj['activeSchema'] !== undefined
        ? String(obj['activeSchema'])
        : undefined,
  };
}

/**
 * Normalize the CLI list output into SchemaEntry objects.
 * The CLI may return plain strings or richer objects.
 */
function normalizeSchemas(raw: (string | SchemaEntry)[]): SchemaEntry[] {
  return raw.map((item) => {
    if (typeof item === 'string') {
      return { name: item };
    }
    return item;
  });
}

/**
 * Parse the schema show JSON output into a SchemaDefinition.
 */
function parseSchemaDefinition(parsed: unknown): SchemaDefinition | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['name'] !== 'string' || !Array.isArray(obj['artifacts'])) {
    return null;
  }

  const artifacts = (obj['artifacts'] as unknown[]).map((a: unknown) => {
    const item = a as Record<string, unknown>;
    return {
      id: String(item['id'] ?? ''),
      generates: String(item['generates'] ?? ''),
      requires: Array.isArray(item['requires'])
        ? item['requires'].map(String)
        : [],
      template: item['template'] !== undefined ? String(item['template']) : undefined,
      instruction: item['instruction'] !== undefined ? String(item['instruction']) : undefined,
      instructionFile: item['instructionFile'] !== undefined ? String(item['instructionFile']) : undefined,
      contextBudget: typeof item['contextBudget'] === 'number' ? item['contextBudget'] : undefined,
      required: item['required'] !== undefined ? Boolean(item['required']) : undefined,
      validation: item['validation'] as SchemaDefinition['artifacts'][0]['validation'],
    };
  });

  return {
    name: String(obj['name']),
    version: Number(obj['version'] ?? 0),
    description: obj['description'] !== undefined ? String(obj['description']) : undefined,
    context: obj['context'] as Record<string, string | number | boolean> | undefined,
    artifacts,
    apply: obj['apply'] as SchemaDefinition['apply'],
  };
}

/**
 * Parse the schema validate JSON output.
 */
function parseValidateResponse(parsed: unknown): SchemaValidateResponse | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['passed'] !== 'boolean') return null;

  return {
    passed: obj['passed'],
    errors: Array.isArray(obj['errors']) ? obj['errors'].map(String) : [],
  };
}

/**
 * Parse the schema fork JSON output.
 */
function parseForkResponse(parsed: unknown): SchemaForkResponse | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  return {
    success: Boolean(obj['success']),
    base: String(obj['base'] ?? ''),
    name: String(obj['name'] ?? ''),
  };
}

/**
 * Detail tabs available when a schema is selected.
 */
type DetailTab = 'details' | 'dag' | 'yaml' | 'diff';

const TAB_LABELS: { tab: DetailTab; label: string }[] = [
  { tab: 'details', label: 'Details' },
  { tab: 'dag', label: 'DAG' },
  { tab: 'yaml', label: 'YAML' },
  { tab: 'diff', label: 'Diff' },
];

const SchemaWorkbench: React.FC<SchemaWorkbenchProps> = ({
  projectInfo,
  loading: projectLoading,
}) => {
  // ── Schema list state ──
  const [schemaEntries, setSchemaEntries] = useState<SchemaEntry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [activeSchema, setActiveSchema] = useState<string | null>(null);

  // ── Selection / detail state ──
  const [selectedSchema, setSelectedSchema] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('details');
  const [schemaDef, setSchemaDef] = useState<SchemaDefinition | null>(null);
  const [showLoading, setShowLoading] = useState(false);
  const [showError, setShowError] = useState<string | null>(null);
  const [validation, setValidation] = useState<SchemaValidateResponse | null>(null);
  const [validateLoading, setValidateLoading] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);

  // ── Fork dialog state ──
  const [showForkDialog, setShowForkDialog] = useState(false);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const [forkSuccess, setForkSuccess] = useState<string | null>(null);
  const [forkedBase, setForkedBase] = useState<string | null>(null);
  const [forkedName, setForkedName] = useState<string | null>(null);

  // ── Diff state ──
  const [baseSchemaDef, setBaseSchemaDef] = useState<SchemaDefinition | null>(null);
  const [forkSchemaDef, setForkSchemaDef] = useState<SchemaDefinition | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // ── YAML editor state ──
  const [yamlContent, setYamlContent] = useState<string>('');
  const [yamlSavedContent, setYamlSavedContent] = useState<string>('');
  const [yamlMtimeMs, setYamlMtimeMs] = useState<number>(0);
  const [yamlLoadedSchema, setYamlLoadedSchema] = useState<string | null>(null);
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlLoadError, setYamlLoadError] = useState<string | null>(null);
  const [yamlSaving, setYamlSaving] = useState(false);
  const [yamlSaveError, setYamlSaveError] = useState<string | null>(null);

  // ── Fetch schema list ──
  const fetchSchemaList = useCallback(async () => {
    if (!projectInfo) return;

    setListLoading(true);
    setListError(null);

    try {
      const event = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['schema', 'list', '--json'],
        cwd: projectInfo.projectRoot,
        initiator: 'user',
      });

      if (event.cancelled) {
        setListError('Schema list command was cancelled.');
        return;
      }

      if (event.exitCode !== 0) {
        const errMsg =
          event.parseError ??
          event.stderr.trim() ??
          `Command exited with code ${event.exitCode ?? 'unknown'}`;
        setListError(errMsg);
        return;
      }

      const parsed = parseSchemaListResponse(event.parsedJson);
      if (!parsed) {
        setListError('Failed to parse schema list output.');
        return;
      }

      const entries = normalizeSchemas(parsed.schemas);
      setSchemaEntries(entries);
      setActiveSchema(parsed.activeSchema || projectInfo.activeSchema || null);
      setListError(null);
    } catch (e) {
      setListError(
        e instanceof Error ? e.message : 'Unknown error fetching schema list.',
      );
    } finally {
      setListLoading(false);
    }
  }, [projectInfo]);

  // ── Schema show ──
  const handleShow = useCallback(
    async (schemaName: string) => {
      if (!projectInfo) return;

      setShowLoading(true);
      setShowError(null);
      setSchemaDef(null);

      try {
        const event = await window.openadab.runCli({
          commandId: genCommandId(),
          args: ['schema', 'show', schemaName, '--json'],
          cwd: projectInfo.projectRoot,
          initiator: 'user',
        });

        if (event.cancelled) {
          setShowError('Show command was cancelled.');
          return;
        }

        if (event.exitCode !== 0) {
          const errMsg =
            event.parseError ??
            event.stderr.trim() ??
            `Command exited with code ${event.exitCode ?? 'unknown'}`;
          setShowError(errMsg);
          return;
        }

        const def = parseSchemaDefinition(event.parsedJson);
        if (!def) {
          setShowError('Failed to parse schema definition.');
          return;
        }

        setSchemaDef(def);
        setShowError(null);
      } catch (e) {
        setShowError(
          e instanceof Error ? e.message : 'Unknown error showing schema.',
        );
      } finally {
        setShowLoading(false);
      }
    },
    [projectInfo],
  );

  // ── Schema validate ──
  const handleValidate = useCallback(
    async (schemaName: string) => {
      if (!projectInfo) return;

      setValidateLoading(true);
      setValidateError(null);
      setValidation(null);

      const schemaPath = schemaDirPath(projectInfo.projectRoot, schemaName);

      try {
        const event = await window.openadab.runCli({
          commandId: genCommandId(),
          args: ['schema', 'validate', schemaPath, '--json'],
          cwd: projectInfo.projectRoot,
          initiator: 'user',
        });

        if (event.cancelled) {
          setValidateError('Validate command was cancelled.');
          return;
        }

        // Validate may exit non-zero on failure but still return parsed JSON
        const parsed = parseValidateResponse(event.parsedJson);
        if (!parsed && event.exitCode !== 0) {
          const errMsg =
            event.parseError ??
            event.stderr.trim() ??
            `Command exited with code ${event.exitCode ?? 'unknown'}`;
          setValidateError(errMsg);
          return;
        }

        if (parsed) {
          setValidation(parsed);
        } else {
          setValidation({ passed: false, errors: ['Failed to parse validation results.'] });
        }
        setValidateError(null);
      } catch (e) {
        setValidateError(
          e instanceof Error ? e.message : 'Unknown error during validation.',
        );
      } finally {
        setValidateLoading(false);
      }
    },
    [projectInfo],
  );

  // ── Schema fork ──
  const handleFork = useCallback(
    async (base: string, name: string) => {
      if (!projectInfo) return;

      setForking(true);
      setForkError(null);
      setForkSuccess(null);

      try {
        const event = await window.openadab.runCli({
          commandId: genCommandId(),
          args: ['schema', 'fork', base, name, '--json'],
          cwd: projectInfo.projectRoot,
          initiator: 'user',
        });

        if (event.cancelled) {
          setForkError('Fork command was cancelled.');
          return;
        }

        if (event.exitCode !== 0) {
          const errMsg =
            event.parseError ??
            event.stderr.trim() ??
            `Command exited with code ${event.exitCode ?? 'unknown'}`;
          setForkError(errMsg);
          return;
        }

        const result = parseForkResponse(event.parsedJson);
        if (!result || !result.success) {
          setForkError('Fork operation did not report success.');
          return;
        }

        setForkSuccess(`Successfully forked ${base} → ${name}`);
        setForkedBase(base);
        setForkedName(name);

        // Refresh schema list
        await fetchSchemaList();
      } catch (e) {
        setForkError(
          e instanceof Error ? e.message : 'Unknown error during fork.',
        );
      } finally {
        setForking(false);
      }
    },
    [projectInfo, fetchSchemaList],
  );

  // ── Load diff when fork completes ──
  useEffect(() => {
    if (!forkedBase || !forkedName || !projectInfo) return;

    const loadDiff = async () => {
      setDiffLoading(true);
      setDiffError(null);

      const loadOne = async (name: string): Promise<SchemaDefinition | null> => {
        const event = await window.openadab.runCli({
          commandId: genCommandId(),
          args: ['schema', 'show', name, '--json'],
          cwd: projectInfo.projectRoot,
          initiator: 'user',
        });
        if (event.cancelled || event.exitCode !== 0) return null;
        return parseSchemaDefinition(event.parsedJson);
      };

      const base = await loadOne(forkedBase);
      const fork = await loadOne(forkedName);

      if (base) setBaseSchemaDef(base);
      if (fork) setForkSchemaDef(fork);

      if (!base || !fork) {
        setDiffError('Failed to load one or both schemas for comparison.');
      } else {
        setDiffError(null);
        setDetailTab('diff');
      }

      setDiffLoading(false);
    };

    loadDiff();
  }, [forkedBase, forkedName, projectInfo]);

  // ── Handle schema selection ──
  const handleSelectSchema = useCallback(
    (schemaName: string) => {
      setSelectedSchema(schemaName);
      setSchemaDef(null);
      setShowError(null);
      setValidation(null);
      setValidateError(null);
      setDetailTab('details');
      setBaseSchemaDef(null);
      setForkSchemaDef(null);
      setForkedBase(null);
      setForkedName(null);
      setYamlContent('');
      setYamlSavedContent('');
      setYamlMtimeMs(0);
      setYamlLoadedSchema(null);
      setYamlLoadError(null);
      setYamlSaveError(null);

      // Auto-load show on select
      handleShow(schemaName);
    },
    [handleShow],
  );

  const handleYamlLoad = useCallback(async () => {
    if (!projectInfo || !selectedSchema) return;

    setYamlLoading(true);
    setYamlLoadError(null);
    setYamlSaveError(null);

    try {
      const response: FileReadResponse = await window.openadab.readFile({
        filePath: schemaYamlPath(projectInfo.projectRoot, selectedSchema),
        encoding: 'utf-8',
      });
      setYamlContent(response.content);
      setYamlSavedContent(response.content);
      setYamlMtimeMs(response.mtimeMs);
      setYamlLoadedSchema(selectedSchema);
    } catch (e) {
      setYamlContent('');
      setYamlSavedContent('');
      setYamlMtimeMs(0);
      setYamlLoadedSchema(selectedSchema);
      setYamlLoadError(
        e instanceof Error ? e.message : 'Unknown error loading schema YAML.',
      );
    } finally {
      setYamlLoading(false);
    }
  }, [projectInfo, selectedSchema]);

  // ── YAML save ──
  const handleYamlSave = useCallback(async () => {
    if (!projectInfo || !selectedSchema) return;

    if (yamlContent.trim().length === 0) {
      setYamlSaveError('Refusing to save an empty schema YAML document.');
      return;
    }

    setYamlSaving(true);
    setYamlSaveError(null);

    const schemaPath = schemaDirPath(projectInfo.projectRoot, selectedSchema);
    const yamlPath = schemaYamlPath(projectInfo.projectRoot, selectedSchema);
    const previousContent = yamlSavedContent;

    try {
      const result: FileWriteResponse = await window.openadab.writeFile({
        filePath: yamlPath,
        content: yamlContent,
        encoding: 'utf-8',
        expectedMtimeMs: yamlMtimeMs > 0 ? yamlMtimeMs : undefined,
      });

      if (result.conflict) {
        setYamlSaveError('File was modified externally since last read. Reload before saving.');
        return;
      }

      const valEvent = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['schema', 'validate', schemaPath, '--json'],
        cwd: projectInfo.projectRoot,
        initiator: 'user',
      });

      const valParsed = parseValidateResponse(valEvent.parsedJson);
      if (!valParsed || !valParsed.passed) {
        const errs =
          valParsed?.errors ??
          [
            valEvent.parseError ??
            valEvent.stderr.trim() ??
            `Command exited with code ${valEvent.exitCode ?? 'unknown'}`,
          ];

        try {
          const rollback = await window.openadab.writeFile({
            filePath: yamlPath,
            content: previousContent,
            encoding: 'utf-8',
            expectedMtimeMs: result.mtimeMs,
          });
          setYamlMtimeMs(rollback.mtimeMs);
          setYamlSavedContent(previousContent);
        } catch (rollbackError) {
          setYamlSaveError(
            `Validation failed and rollback failed:\n${errs.join('\n')}\n\nRollback: ${
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError)
            }`,
          );
          return;
        }

        setYamlSaveError(`Validation failed. Changes were not saved:\n${errs.join('\n')}`);
        return;
      }

      setYamlMtimeMs(result.mtimeMs);
      setYamlSavedContent(yamlContent);
      setYamlLoadedSchema(selectedSchema);
      setValidation(valParsed);
      setValidateError(null);
      setYamlSaveError(null);
      handleShow(selectedSchema);
    } catch (e) {
      setYamlSaveError(
        e instanceof Error ? e.message : 'Unknown error saving YAML.',
      );
    } finally {
      setYamlSaving(false);
    }
  }, [
    projectInfo,
    selectedSchema,
    yamlContent,
    yamlSavedContent,
    yamlMtimeMs,
    handleShow,
  ]);

  // ── Initial load + refresh on command completion ──
  useEffect(() => {
    if (projectInfo) {
      fetchSchemaList();
    }
  }, [projectInfo, fetchSchemaList]);

  useEffect(() => {
    if (
      detailTab === 'yaml' &&
      selectedSchema &&
      yamlLoadedSchema !== selectedSchema &&
      !yamlLoading
    ) {
      handleYamlLoad();
    }
  }, [
    detailTab,
    selectedSchema,
    yamlLoadedSchema,
    yamlLoading,
    handleYamlLoad,
  ]);

  useEffect(() => {
    const unsub = window.openadab.onCommandComplete((event: CommandEvent) => {
      if (!projectInfo) return;
      const args = event.args;
      if (args.includes('schema') && event.initiator !== 'auto-refresh') {
        fetchSchemaList();
      }
    });
    return unsub;
  }, [projectInfo, fetchSchemaList]);

  // ── Schema names list (for fork dropdown etc.) ──
  const schemaNames = useMemo(
    () => schemaEntries.map((s) => s.name),
    [schemaEntries],
  );
  const yamlDirty = yamlContent !== yamlSavedContent;
  const yamlSaveDisabled =
    yamlSaving ||
    yamlLoading ||
    yamlLoadError !== null ||
    yamlContent.trim().length === 0 ||
    !yamlDirty;

  // ── Loading state (initial project load) ──
  if (projectLoading) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 24px',
            gap: 16,
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: '3px solid #d1d5db',
              borderTopColor: '#3b82f6',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block',
            }}
          />
          <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
            Loading project workspace…
          </span>
        </div>
      </div>
    );
  }

  // ── No project open ──
  if (!projectInfo) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 24px',
            gap: 16,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: '#f3f4f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              color: '#9ca3af',
            }}
          >
            📂
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 600,
              color: '#374151',
            }}
          >
            No Project Open
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '0.85rem',
              color: '#6b7280',
              textAlign: 'center',
            }}
          >
            Open a project to manage schemas.
          </p>
        </div>
      </div>
    );
  }

  // ── Main layout ──
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#fafafa',
        }}
      >
        <span
          style={{
            fontSize: '0.78rem',
            fontWeight: 600,
            color: '#374151',
          }}
        >
          Schema Workbench
        </span>

        <button
          type="button"
          onClick={() => {
            setShowForkDialog(true);
            setForkError(null);
            setForkSuccess(null);
          }}
          style={{
            marginLeft: 'auto',
            padding: '6px 14px',
            border: '1px solid #2563eb',
            borderRadius: 4,
            backgroundColor: '#eff6ff',
            color: '#1d4ed8',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Fork Schema
        </button>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left: Schema list */}
        <div
          style={{
            width: 260,
            borderRight: '1px solid #e5e7eb',
            backgroundColor: '#fff',
            overflow: 'auto',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid #f3f4f6',
              fontSize: '0.7rem',
              fontWeight: 600,
              color: '#6b7280',
            }}
          >
            Installed Schemas
          </div>
          <SchemaList
            schemas={schemaEntries}
            activeSchema={activeSchema}
            loading={listLoading}
            error={listError}
            onSelect={handleSelectSchema}
            selectedSchema={selectedSchema}
            onRefresh={fetchSchemaList}
          />
        </div>

        {/* Right: Detail area */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          {/* Detail tabs */}
          {selectedSchema && (
            <div
              style={{
                display: 'flex',
                gap: 0,
                borderBottom: '1px solid #e5e7eb',
                backgroundColor: '#fafafa',
                padding: '0 12px',
              }}
            >
              {TAB_LABELS.map(({ tab, label }) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDetailTab(tab)}
                  disabled={tab === 'diff' && !forkedBase && !forkedName}
                  style={{
                    padding: '6px 14px',
                    border: 'none',
                    borderBottom:
                      detailTab === tab
                        ? '2px solid #2563eb'
                        : '2px solid transparent',
                    backgroundColor: 'transparent',
                    color: detailTab === tab ? '#1d4ed8' : '#6b7280',
                    fontSize: '0.73rem',
                    fontWeight: detailTab === tab ? 600 : 400,
                    cursor: tab === 'diff' && !forkedBase ? 'not-allowed' : 'pointer',
                    opacity: tab === 'diff' && !forkedBase && !forkedName ? 0.4 : 1,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Tab: Details */}
          {selectedSchema && detailTab === 'details' && (
            <SchemaDetail
              schemaName={selectedSchema}
              schemaDef={schemaDef}
              showLoading={showLoading}
              showError={showError}
              validation={validation}
              validateLoading={validateLoading}
              validateError={validateError}
              onShow={handleShow}
              onValidate={handleValidate}
              onClose={() => {
                setSelectedSchema(null);
                setSchemaDef(null);
                setValidation(null);
              }}
            />
          )}

          {/* Tab: DAG */}
          {selectedSchema && detailTab === 'dag' && (
            <div style={{ padding: 16 }}>
              <SchemaDAG
                schemaName={selectedSchema}
                artifacts={schemaDef?.artifacts ?? []}
                loading={showLoading}
                error={showError}
              />
            </div>
          )}

          {/* Tab: YAML */}
          {selectedSchema && detailTab === 'yaml' && (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  fontSize: '0.7rem',
                  color: '#6b7280',
                }}
              >
                Edit the raw schema YAML definition. Saves are kept only when schema validation passes.
              </div>

              {yamlLoading && (
                <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                  Loading schema.yaml…
                </div>
              )}

              {yamlLoadError && (
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 4,
                    fontSize: '0.72rem',
                    fontFamily: 'monospace',
                    color: '#dc2626',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  Failed to load schema.yaml: {yamlLoadError}
                </div>
              )}

              <textarea
                value={yamlContent}
                onChange={(e) => setYamlContent(e.target.value)}
                disabled={yamlSaving || yamlLoading || yamlLoadError !== null}
                rows={20}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  fontFamily: 'monospace',
                  color: '#1f2937',
                  backgroundColor: '#fafafa',
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                spellCheck={false}
              />

              {yamlSaveError && (
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 4,
                    fontSize: '0.72rem',
                    fontFamily: 'monospace',
                    color: '#dc2626',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {yamlSaveError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleYamlSave}
                  disabled={yamlSaveDisabled}
                  style={{
                    padding: '6px 16px',
                    border: 'none',
                    borderRadius: 4,
                    backgroundColor: yamlSaveDisabled ? '#9ca3af' : '#059669',
                    color: '#fff',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: yamlSaveDisabled ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {yamlSaving && (
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,0.4)',
                        borderTopColor: '#fff',
                        animation: 'spin 0.8s linear infinite',
                        display: 'inline-block',
                      }}
                    />
                  )}
                  {yamlSaving ? 'Saving…' : 'Validate & Save'}
                </button>
                <button
                  type="button"
                  onClick={handleYamlLoad}
                  disabled={yamlSaving || yamlLoading}
                  style={{
                    padding: '6px 14px',
                    border: '1px solid #d1d5db',
                    borderRadius: 4,
                    backgroundColor: '#fff',
                    color: '#374151',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: yamlSaving || yamlLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Reload
                </button>
                {yamlDirty && !yamlLoading && !yamlLoadError && (
                  <span
                    style={{
                      alignSelf: 'center',
                      fontSize: '0.68rem',
                      color: '#d97706',
                      fontWeight: 600,
                    }}
                  >
                    Unsaved changes
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Tab: Diff */}
          {selectedSchema && detailTab === 'diff' && (
            <div style={{ padding: 16 }}>
              <SchemaDiffView
                baseName={forkedBase ?? ''}
                forkName={forkedName ?? ''}
                baseArtifacts={baseSchemaDef?.artifacts ?? []}
                forkArtifacts={forkSchemaDef?.artifacts ?? []}
                loading={diffLoading}
                error={diffError}
              />
            </div>
          )}

          {/* No schema selected */}
          {!selectedSchema && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                gap: 12,
                color: '#9ca3af',
                fontSize: '0.85rem',
              }}
            >
              <span style={{ fontSize: '2rem' }}>📐</span>
              <span>Select a schema from the list to view its details.</span>
            </div>
          )}
        </div>
      </div>

      {/* Fork dialog */}
      {showForkDialog && (
        <SchemaForkDialog
          schemaNames={schemaNames}
          forking={forking}
          forkError={forkError}
          forkSuccess={forkSuccess}
          onFork={handleFork}
          onClose={() => {
            setShowForkDialog(false);
            if (forkSuccess) {
              setForkError(null);
              setForkSuccess(null);
            }
          }}
        />
      )}
    </div>
  );
};

export default SchemaWorkbench;
