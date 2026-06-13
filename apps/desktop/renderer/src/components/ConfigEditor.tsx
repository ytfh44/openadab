/**
 * Config editor panel for the Project Dashboard.
 *
 * Provides a simple key-value form to read and write OpenAdab project
 * configuration via `openadab config get <path> --json` and
 * `openadab config set <path> <value>` with explicit raw/JSON mode.
 *
 * Displays a summary of known config values from the current project info
 * and allows ad-hoc get/set operations on arbitrary dot-paths.
 *
 * Handles loading, error, empty, and command-failure states.
 */

import React, { useState, useCallback } from 'react';
import type { ProjectInfo, CommandEvent } from '../../../shared/ipc-types.js';

interface ConfigEditorProps {
  /** Current project info, or null if no project is open. */
  projectInfo: ProjectInfo | null;
  /** Called after a successful config mutation to prompt a refresh. */
  onConfigChanged: () => void;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

/** How the CLI should interpret a config value during `config set`. */
export type ConfigValueMode = 'raw' | 'json';

/**
 * Build the exact CLI argument array for setting a config value.
 *
 * @param path - Dot-path to the target config key.
 * @param value - Raw input value from the user.
 * @param mode - Whether the value should be parsed by the CLI as JSON.
 * @returns Arguments for `openadab`.
 */
export function buildConfigSetArgs(
  path: string,
  value: string,
  mode: ConfigValueMode,
): string[] {
  const args = ['config', 'set', path, value];
  if (mode === 'json') {
    args.push('--json');
  }
  return args;
}

/**
 * Return helper text for the selected config value mode.
 */
function configValueModeHint(mode: ConfigValueMode): string {
  return mode === 'json'
    ? 'JSON mode parses numbers, booleans, arrays, objects, and quoted strings.'
    : 'Raw mode stores ordinary text exactly as entered.';
}

const ConfigEditor: React.FC<ConfigEditorProps> = ({
  projectInfo,
  onConfigChanged,
}) => {
  const [configPath, setConfigPath] = useState('');
  const [configValue, setConfigValue] = useState('');
  const [configValueMode, setConfigValueMode] =
    useState<ConfigValueMode>('raw');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Run a config CLI command and display the result. */
  const runConfigCommand = useCallback(
    async (args: string[]) => {
      if (!projectInfo) return;

      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const event: CommandEvent = await window.openadab.runCli({
          commandId: genCommandId(),
          args,
          cwd: projectInfo.projectRoot,
          initiator: 'user',
        });

        if (event.cancelled) {
          setError('Command was cancelled.');
          return;
        }

        if (event.exitCode !== 0) {
          const errMsg =
            event.parseError ??
            event.stderr.trim() ??
            `Command exited with code ${event.exitCode ?? 'unknown'}`;
          setError(errMsg);
          return;
        }

        // Format the result for display
        if (event.parsedJson !== undefined) {
          setResult(JSON.stringify(event.parsedJson, null, 2));
        } else {
          setResult(event.stdout.trim() || '(empty result)');
        }

        onConfigChanged();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Unknown error.',
        );
      } finally {
        setLoading(false);
      }
    },
    [projectInfo, onConfigChanged],
  );

  const handleGet = useCallback(() => {
    const trimmed = configPath.trim();
    if (!trimmed) {
      setError('Config path is required.');
      return;
    }
    runConfigCommand(['config', 'get', trimmed, '--json']);
  }, [configPath, runConfigCommand]);

  const handleSet = useCallback(() => {
    const trimmedPath = configPath.trim();
    if (!trimmedPath) {
      setError('Config path is required.');
      return;
    }
    runConfigCommand(buildConfigSetArgs(
      trimmedPath,
      configValue,
      configValueMode,
    ));
  }, [configPath, configValue, configValueMode, runConfigCommand]);

  // ── Empty state (no project) ──
  if (!projectInfo) {
    return (
      <PanelShell title="Config">
        <EmptyMessage text="No project open — select or create one" />
      </PanelShell>
    );
  }

  // ── Config summary from project info ──
  const configKeys =
    projectInfo.config != null ? Object.keys(projectInfo.config) : [];
  const hasConfig = configKeys.length > 0;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    fontSize: '0.8rem',
    fontFamily: 'monospace',
    boxSizing: 'border-box',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#6b7280',
    marginBottom: 3,
  };

  return (
    <PanelShell title="Config">
      {/* Config summary */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: '#6b7280',
            marginBottom: 6,
          }}
        >
          CURRENT VALUES
        </div>
        {!hasConfig ? (
          <div
            style={{
              fontSize: '0.78rem',
              color: '#9ca3af',
              fontStyle: 'italic',
            }}
          >
            No config values set.
          </div>
        ) : (
          <div
            style={{
              backgroundColor: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 4,
              padding: 8,
              maxHeight: 140,
              overflow: 'auto',
            }}
          >
            {configKeys.map((key) => {
              const val = projectInfo.config![key];
              const displayVal =
                typeof val === 'string'
                  ? val
                  : JSON.stringify(val);
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '2px 0',
                    fontSize: '0.75rem',
                    fontFamily: 'monospace',
                  }}
                >
                  <span
                    style={{
                      color: '#7b4fbf',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {key}
                  </span>
                  <span style={{ color: '#6b7280' }}>=</span>
                  <span
                    style={{
                      color: '#374151',
                      wordBreak: 'break-all',
                    }}
                  >
                    {displayVal}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Get / Set form */}
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle} htmlFor="config-path">
          Config Path (dot-path)
        </label>
        <input
          id="config-path"
          type="text"
          value={configPath}
          onChange={(e) => setConfigPath(e.target.value)}
          placeholder="project.name"
          disabled={loading}
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle} htmlFor="config-value">
          Value (for set)
        </label>
        <input
          id="config-value"
          type="text"
          value={configValue}
          onChange={(e) => setConfigValue(e.target.value)}
          placeholder="My Novel"
          disabled={loading}
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle} htmlFor="config-value-mode">
          Value Mode
        </label>
        <select
          id="config-value-mode"
          value={configValueMode}
          onChange={(e) =>
            setConfigValueMode(e.target.value as ConfigValueMode)}
          disabled={loading}
          style={inputStyle}
        >
          <option value="raw">Raw string</option>
          <option value="json">JSON</option>
        </select>
        <div
          style={{
            marginTop: 4,
            fontSize: '0.65rem',
            color: '#6b7280',
            lineHeight: 1.4,
          }}
        >
          {configValueModeHint(configValueMode)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <ActionButton
          label="Get"
          onClick={handleGet}
          loading={loading}
          variant="primary"
        />
        <ActionButton
          label="Set"
          onClick={handleSet}
          loading={loading}
          variant="warning"
        />
      </div>

      {/* Loading */}
      {loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 0',
            color: '#6b7280',
            fontSize: '0.78rem',
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '2px solid #9ca3af',
              borderTopColor: 'transparent',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block',
            }}
          />
          Running config command…
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '8px 10px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            color: '#dc2626',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {error}
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <pre
          style={{
            margin: '8px 0 0 0',
            padding: 8,
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 4,
            fontSize: '0.72rem',
            fontFamily: 'monospace',
            color: '#166534',
            maxHeight: 200,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {result}
        </pre>
      )}
    </PanelShell>
  );
};

/** Reusable panel wrapper with header. */
const PanelShell: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <div
    style={{
      backgroundColor: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      padding: 16,
      fontFamily: 'system-ui, sans-serif',
    }}
  >
    <h3
      style={{
        margin: '0 0 12px 0',
        fontSize: '0.85rem',
        fontWeight: 700,
        color: '#111827',
      }}
    >
      {title}
    </h3>
    {children}
  </div>
);

/** Reusable empty-state message. */
const EmptyMessage: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      padding: 20,
      textAlign: 'center',
      color: '#9ca3af',
      fontSize: '0.8rem',
      fontStyle: 'italic',
    }}
  >
    {text}
  </div>
);

/** Action button used in config panel. */
const ActionButton: React.FC<{
  label: string;
  onClick: () => void;
  loading: boolean;
  variant: 'primary' | 'warning';
}> = ({ label, onClick, loading, variant }) => {
  const bg =
    variant === 'primary'
      ? loading
        ? '#86c5f7'
        : '#3b82f6'
      : loading
        ? '#fcd34d'
        : '#f59e0b';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      style={{
        padding: '6px 16px',
        border: 'none',
        borderRadius: 4,
        backgroundColor: bg,
        color: variant === 'warning' ? '#1c1917' : '#fff',
        fontSize: '0.78rem',
        fontWeight: 600,
        cursor: loading ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
};

export default ConfigEditor;
