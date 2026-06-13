/**
 * Agent Dock — full agent interface route.
 *
 * Provides the complete agent interaction surface:
 * - Left column: active session chat (AgentSessionPanel)
 * - Right column: agent configuration (AgentConfigPanel)
 * - Modal overlay: permission requests (PermissionModal)
 *
 * Manages agent config state, session lifecycle, and permission request
 * routing between the main process (AgentSupervisor) and the renderer.
 *
 * Graceful degradation: when mode is 'none', shows a "Configure an agent
 * to get started" placeholder. When agent process fails, shows error with
 * restart button.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { AgentSpawnFailedEvent, ProjectInfo, PermissionRequest, PermissionResponse } from '../../../shared/ipc-types.js';
import AgentSessionPanel from '../components/AgentSessionPanel.js';
import AgentConfigPanel from '../components/AgentConfigPanel.js';
import type { AgentConfigState, AgentMode } from '../components/AgentConfigPanel.js';
import PermissionModal from '../components/PermissionModal.js';

interface AgentDockProps {
  /** Current project info. */
  projectInfo: ProjectInfo | null;
}

const DEFAULT_CONFIG: AgentConfigState = {
  mode: 'opencode-default',
  agentCommand: 'opencode',
  args: 'agent --acp',
  cwd: '',
  apiKey: '',
};

const AgentDock: React.FC<AgentDockProps> = ({ projectInfo }) => {
  // ── Config state ──
  const [config, setConfig] = useState<AgentConfigState>(() => {
    try {
      const stored = localStorage.getItem('openadab-agent-config');
      if (stored) return { ...DEFAULT_CONFIG, ...JSON.parse(stored) as Partial<AgentConfigState> };
    } catch { /* ignore */ }
    return DEFAULT_CONFIG;
  });

  // ── Session state ──
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState('Idle');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Permission state ──
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);

  // Persist config to localStorage
  useEffect(() => {
    localStorage.setItem('openadab-agent-config', JSON.stringify(config));
  }, [config]);

  // Subscribe to permission requests from main process
  useEffect(() => {
    const unsub = window.openadab.onPermissionRequest(
      (request: PermissionRequest) => {
        setPendingPermission(request);
      },
    );
    return unsub;
  }, []);

  // Subscribe to spawn-failed events from main process
  useEffect(() => {
    const unsub = window.openadab.onAgentSpawnFailed(
      (event: AgentSpawnFailedEvent) => {
        setError(event.error);
        setSessionActive(false);
        setStarting(false);
      },
    );
    return unsub;
  }, []);

  // ── Session actions ──

  const handleStartSession = useCallback(async () => {
    if (config.mode === 'none') return;
    setStarting(true);
    setError(null);

    try {
      const args = config.args
        .split(/\s+/)
        .filter((a) => a.length > 0);
      const result = await window.openadab.startAgentSession({
        agentCommand: config.agentCommand,
        args,
        cwd: config.cwd || projectInfo?.projectRoot || '',
      });
      setSessionId(result.sessionId);
      setSessionActive(true);
      setSessionStatus('Running');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setSessionActive(false);
    } finally {
      setStarting(false);
    }
  }, [config, projectInfo]);

  const handleStopSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      await window.openadab.stopAgentSession({ sessionId });
    } catch { /* best effort */ }
    setSessionActive(false);
    setSessionId(null);
    setSessionStatus('Stopped');
    setError(null);
  }, [sessionId]);

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (!sessionId) return;
      await window.openadab.sendAgentMessage({ sessionId, message });
    },
    [sessionId],
  );

  // ── Permission actions ──

  const handleApprovePermission = useCallback(
    async (response: PermissionResponse) => {
      await window.openadab.approvePermission(response);
      setPendingPermission(null);
    },
    [],
  );

  const handleDenyPermission = useCallback(
    async (response: PermissionResponse) => {
      await window.openadab.denyPermission(response);
      setPendingPermission(null);
    },
    [],
  );

  // ── Render ──

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        minHeight: 0,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Main chat area */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #e5e7eb',
        }}
      >
        <div
          style={{
            padding: '10px 16px',
            backgroundColor: '#f9fafb',
            borderBottom: '1px solid #e5e7eb',
            flexShrink: 0,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '0.9rem',
              fontWeight: 700,
              color: '#111827',
            }}
          >
            Agent Dock
          </h2>
          <div
            style={{
              fontSize: '0.65rem',
              color: '#9ca3af',
              marginTop: 2,
            }}
          >
            {projectInfo ? projectInfo.title ?? projectInfo.projectRoot : 'No project'}
          </div>
        </div>

        <AgentSessionPanel
          config={config}
          sessionActive={sessionActive}
          sessionId={sessionId}
          sessionStatus={sessionStatus}
          onStartSession={handleStartSession}
          onStopSession={handleStopSession}
          onSendMessage={handleSendMessage}
          starting={starting}
          error={error}
        />
      </div>

      {/* Config sidebar */}
      <div
        style={{
          width: 300,
          minWidth: 260,
          overflow: 'auto',
          padding: 14,
          backgroundColor: '#ffffff',
          flexShrink: 0,
        }}
      >
        <AgentConfigPanel
          config={config}
          onConfigChange={setConfig}
          sessionActive={sessionActive}
        />

        {/* Activity summary */}
        <div
          style={{
            marginTop: 16,
            padding: '12px 14px',
            backgroundColor: '#f9fafb',
            borderRadius: 6,
            border: '1px solid #e5e7eb',
          }}
        >
          <h4
            style={{
              margin: '0 0 8px 0',
              fontSize: '0.72rem',
              fontWeight: 600,
              color: '#374151',
            }}
          >
            Session Info
          </h4>
          <div style={{ fontSize: '0.65rem', color: '#6b7280', lineHeight: 1.6 }}>
            <div>
              Status:{' '}
              <span
                style={{
                  fontWeight: 600,
                  color: sessionActive ? '#059669' : '#9ca3af',
                }}
              >
                {sessionActive ? 'Active' : 'Idle'}
              </span>
            </div>
            {sessionId && (
              <div style={{ marginTop: 2 }}>
                ID:{' '}
                <span style={{ fontFamily: 'monospace' }}>
                  {sessionId.slice(0, 12)}...
                </span>
              </div>
            )}
            <div style={{ marginTop: 2 }}>
              Mode:{' '}
              <span style={{ fontWeight: 600 }}>{config.mode}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Permission Modal */}
      {pendingPermission && (
        <PermissionModal
          request={pendingPermission}
          onApprove={handleApprovePermission}
          onDeny={handleDenyPermission}
        />
      )}
    </div>
  );
};

export default AgentDock;
