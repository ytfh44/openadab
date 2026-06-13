/**
 * AgentConfigPanel — agent configuration UI.
 *
 * Displays and edits agent settings: mode selector (OpenCode default,
 * custom command, or none), agent command path, arguments, working
 * directory, and optional API key.
 *
 * Configuration is stored in the renderer state and passed to the
 * main process via `agent:start-session`.
 */

import React, { useState } from 'react';

/** Supported agent modes. */
export type AgentMode = 'opencode-default' | 'custom-command' | 'none';

/** Agent configuration as managed by the UI. */
export interface AgentConfigState {
  mode: AgentMode;
  agentCommand: string;
  args: string;
  cwd: string;
  apiKey: string;
}

const DEFAULT_OPECODE_COMMAND = 'opencode';
const DEFAULT_OPECODE_ARGS = 'acp';

interface AgentConfigPanelProps {
  /** Current configuration state. */
  config: AgentConfigState;
  /** Called when configuration changes. */
  onConfigChange: (config: AgentConfigState) => void;
  /** Whether a session is currently active. */
  sessionActive: boolean;
}

const modeLabels: Record<AgentMode, string> = {
  'opencode-default': 'OpenCode Default',
  'custom-command': 'Custom Command',
  none: 'None (Disabled)',
};

const AgentConfigPanel: React.FC<AgentConfigPanelProps> = ({
  config,
  onConfigChange,
  sessionActive,
}) => {
  const [showApiKey, setShowApiKey] = useState(false);

  const update = (patch: Partial<AgentConfigState>): void => {
    onConfigChange({ ...config, ...patch });
  };

  const handleModeChange = (mode: AgentMode): void => {
    const patch: Partial<AgentConfigState> = { mode };
    if (mode === 'opencode-default') {
      patch.agentCommand = DEFAULT_OPECODE_COMMAND;
      patch.args = DEFAULT_OPECODE_ARGS;
    }
    if (mode === 'none') {
      patch.agentCommand = '';
      patch.args = '';
    }
    onConfigChange({ ...config, ...patch });
  };

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '16px 14px',
        backgroundColor: '#f9fafb',
        borderRadius: 6,
        border: '1px solid #e5e7eb',
      }}
    >
      <h3
        style={{
          margin: '0 0 12px 0',
          fontSize: '0.82rem',
          fontWeight: 700,
          color: '#374151',
        }}
      >
        Agent Configuration
      </h3>

      {/* Mode Selector */}
      <div style={{ marginBottom: 14 }}>
        <label
          style={{
            display: 'block',
            fontSize: '0.68rem',
            fontWeight: 600,
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 6,
          }}
        >
          Mode
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(Object.keys(modeLabels) as AgentMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={sessionActive}
              onClick={() => handleModeChange(mode)}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 4,
                border:
                  config.mode === mode
                    ? '2px solid #059669'
                    : '1px solid #d1d5db',
                backgroundColor:
                  config.mode === mode ? '#ecfdf5' : '#ffffff',
                color: config.mode === mode ? '#065f46' : '#374151',
                fontSize: '0.7rem',
                fontWeight: config.mode === mode ? 600 : 400,
                cursor: sessionActive ? 'not-allowed' : 'pointer',
                opacity: sessionActive ? 0.6 : 1,
              }}
            >
              {modeLabels[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* Command */}
      {config.mode === 'custom-command' && (
        <>
          <FieldLabel text="Agent Command" />
          <input
            type="text"
            disabled={sessionActive}
            placeholder="e.g. opencode, node ./agent.js"
            value={config.agentCommand}
            onChange={(e) => update({ agentCommand: e.target.value })}
            style={inputStyle(sessionActive)}
          />

          <FieldLabel text="Arguments" />
          <input
            type="text"
            disabled={sessionActive}
            placeholder="e.g. acp --model sonnet"
            value={config.args}
            onChange={(e) => update({ args: e.target.value })}
            style={inputStyle(sessionActive)}
          />
        </>
      )}

      {config.mode === 'opencode-default' && (
        <div
          style={{
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: 4,
            padding: '8px 12px',
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: '0.7rem',
              fontFamily: 'monospace',
              color: '#065f46',
            }}
          >
            {DEFAULT_OPECODE_COMMAND} {DEFAULT_OPECODE_ARGS}
          </div>
          <div
            style={{
              fontSize: '0.62rem',
              color: '#059669',
              marginTop: 4,
            }}
          >
            Uses the default OpenCode ACP configuration.
          </div>
        </div>
      )}

      {/* Working Directory */}
      <FieldLabel text="Working Directory" />
      <input
        type="text"
        disabled={sessionActive}
        placeholder="Leave empty for project root"
        value={config.cwd}
        onChange={(e) => update({ cwd: e.target.value })}
        style={inputStyle(sessionActive)}
      />

      {/* API Key */}
      <FieldLabel text="API Key" sub="(if required by agent)" />
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type={showApiKey ? 'text' : 'password'}
          disabled={sessionActive}
          placeholder="sk-..."
          value={config.apiKey}
          onChange={(e) => update({ apiKey: e.target.value })}
          style={inputStyle(sessionActive)}
        />
        <button
          type="button"
          disabled={sessionActive}
          onClick={() => setShowApiKey(!showApiKey)}
          style={{
            padding: '6px 10px',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            backgroundColor: '#ffffff',
            color: '#6b7280',
            fontSize: '0.68rem',
            cursor: sessionActive ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {showApiKey ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
};

/** A small label for form fields. */
const FieldLabel: React.FC<{ text: string; sub?: string }> = ({
  text,
  sub,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'baseline',
      gap: 6,
      marginBottom: 4,
      marginTop: 12,
    }}
  >
    <span
      style={{
        fontSize: '0.68rem',
        fontWeight: 600,
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {text}
    </span>
    {sub && (
      <span style={{ fontSize: '0.6rem', color: '#9ca3af' }}>{sub}</span>
    )}
  </div>
);

/** Base input styling. */
function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '6px 10px',
    borderRadius: 4,
    border: '1px solid #d1d5db',
    fontSize: '0.75rem',
    fontFamily: 'monospace',
    color: '#111827',
    backgroundColor: disabled ? '#f3f4f6' : '#ffffff',
    cursor: disabled ? 'not-allowed' : 'text',
  };
}

export default AgentConfigPanel;
