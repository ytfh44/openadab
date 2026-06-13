/**
 * AgentStatusCard — compact agent status indicator for the Inspector panel.
 *
 * Shows whether an agent is configured and its current session status.
 * Provides a quick link to the full Agent Dock route.
 * Handles states: no config, config inactive, session running, session error.
 */

import React, { useState, useEffect } from 'react';
import type { AgentMessageEvent } from '../../../shared/ipc-types.js';

type CardStatus = 'no-config' | 'configured' | 'running' | 'error';

const AgentStatusCard: React.FC = () => {
  const [status, setStatus] = useState<CardStatus>('no-config');
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsub = window.openadab.onAgentMessage(
      (event: AgentMessageEvent) => {
        if (event.role === 'system') {
          if (event.content.includes('started')) {
            setStatus('running');
          } else if (event.content.includes('exited') || event.content.includes('stopped')) {
            setStatus('configured');
          } else if (event.content.includes('error') || event.content.includes('Failed')) {
            setStatus('error');
            setErrorMsg(event.content);
          }
          setLastMessage(event.content.slice(0, 120));
        }
      },
    );
    return unsub;
  }, []);

  // Try to detect config state from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('openadab-agent-config');
      if (stored) {
        const parsed = JSON.parse(stored) as { mode?: string };
        if (parsed.mode && parsed.mode !== 'none') {
          setStatus('configured');
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  const statusConfig: Record<
    CardStatus,
    { icon: string; label: string; color: string; bg: string }
  > = {
    'no-config': {
      icon: '\u{1F6AB}',
      label: 'Not Configured',
      color: '#9ca3af',
      bg: '#f9fafb',
    },
    configured: {
      icon: '\u{1F7E2}',
      label: 'Ready',
      color: '#059669',
      bg: '#ecfdf5',
    },
    running: {
      icon: '\u{1F916}',
      label: 'Agent Running',
      color: '#0891b2',
      bg: '#ecfeff',
    },
    error: {
      icon: '\u26A0\uFE0F',
      label: 'Agent Error',
      color: '#dc2626',
      bg: '#fef2f2',
    },
  };

  const current = statusConfig[status];

  return (
    <div
      style={{
        border: '1px solid #d1d5db',
        borderRadius: 6,
        marginBottom: 8,
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          backgroundColor: '#e5e7eb',
          fontSize: '0.68rem',
          fontWeight: 700,
          color: '#374151',
        }}
      >
        <span>{'\u{1F916}'}</span>
        Agent Dock
      </div>

      {/* Body */}
      <div
        style={{
          padding: '10px 12px',
          backgroundColor: current.bg,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {/* Status indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: '0.9rem' }}>{current.icon}</span>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: current.color,
            }}
          >
            {current.label}
          </span>
        </div>

        {/* Last message */}
        {lastMessage && (
          <div
            style={{
              fontSize: '0.6rem',
              color: '#6b7280',
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {lastMessage}
          </div>
        )}

        {/* Error detail */}
        {status === 'error' && errorMsg && (
          <div
            style={{
              fontSize: '0.6rem',
              color: '#dc2626',
              lineHeight: 1.4,
            }}
          >
            {errorMsg.slice(0, 150)}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentStatusCard;
