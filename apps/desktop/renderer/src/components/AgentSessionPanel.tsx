/**
 * AgentSessionPanel — active agent session UI.
 *
 * Displays the current session status, message history (scrolling chat log),
 * start/stop controls, and a message input field. Messages flow in via
 * `window.openadab.onAgentMessage()` events.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentMessageEvent } from '../../../shared/ipc-types.js';
import type { AgentConfigState } from './AgentConfigPanel.js';

interface AgentSessionPanelProps {
  /** Current agent configuration. */
  config: AgentConfigState;
  /** Whether a session is currently active. */
  sessionActive: boolean;
  /** Current session ID, or null. */
  sessionId: string | null;
  /** Session status text. */
  sessionStatus: string;
  /** Called to start a new session. */
  onStartSession: () => Promise<void>;
  /** Called to stop the active session. */
  onStopSession: () => Promise<void>;
  /** Called to send a message to the agent. */
  onSendMessage: (message: string) => Promise<void>;
  /** Whether we're currently starting a session. */
  starting: boolean;
  /** Error message from last session operation. */
  error: string | null;
}

/** A message displayed in the chat log. */
interface ChatMessage {
  id: string;
  role: 'agent' | 'system' | 'user';
  content: string;
  timestamp: string;
}

function genId(): string {
  return crypto.randomUUID();
}

const AgentSessionPanel: React.FC<AgentSessionPanelProps> = ({
  config,
  sessionActive,
  sessionId,
  sessionStatus,
  onStartSession,
  onStopSession,
  onSendMessage,
  starting,
  error,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Subscribe to agent messages from main process
  useEffect(() => {
    const unsub = window.openadab.onAgentMessage(
      (event: AgentMessageEvent) => {
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: event.role,
            content: event.content,
            timestamp: event.timestamp,
          },
        ]);
      },
    );
    return unsub;
  }, []);

  // Clear messages when session stops
  useEffect(() => {
    if (!sessionActive) {
      setMessages([]);
    }
  }, [sessionActive]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || !sessionActive) return;

    setSending(true);
    // Add user message to local log immediately
    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');

    try {
      await onSendMessage(text);
    } catch {
      // Error handled by parent
    } finally {
      setSending(false);
    }
  }, [inputValue, sessionActive, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Controls bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          backgroundColor: '#f3f4f6',
          borderBottom: '1px solid #e5e7eb',
          flexShrink: 0,
        }}
      >
        {!sessionActive ? (
          <button
            type="button"
            onClick={() => void onStartSession()}
            disabled={starting || config.mode === 'none'}
            style={{
              padding: '6px 16px',
              borderRadius: 4,
              border: 'none',
              backgroundColor:
                config.mode === 'none' ? '#d1d5db' : '#059669',
              color: '#ffffff',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor:
                starting || config.mode === 'none'
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            {starting ? 'Starting...' : 'Start Session'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void onStopSession()}
            style={{
              padding: '6px 16px',
              borderRadius: 4,
              border: 'none',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Stop
          </button>
        )}

        {/* Status indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: '0.68rem',
            color: '#6b7280',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: sessionActive ? '#059669' : '#d1d5db',
              flexShrink: 0,
            }}
          />
          {sessionActive ? sessionStatus : 'Idle'}
        </div>

        {/* Session ID */}
        {sessionId && (
          <span
            style={{
              fontSize: '0.6rem',
              fontFamily: 'monospace',
              color: '#9ca3af',
              marginLeft: 'auto',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sessionId.slice(0, 8)}...
          </span>
        )}

        {error && (
          <span
            style={{
              fontSize: '0.65rem',
              color: '#dc2626',
              marginLeft: 'auto',
            }}
          >
            {error}
          </span>
        )}
      </div>

      {/* Message log */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '10px 14px',
          backgroundColor: '#ffffff',
        }}
      >
        {messages.length === 0 && !sessionActive && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 8,
              color: '#9ca3af',
            }}
          >
            <span style={{ fontSize: '1.5rem' }}>{'\u{1F4AC}'}</span>
            <span style={{ fontSize: '0.75rem' }}>
              {config.mode === 'none'
                ? 'Configure an agent to get started'
                : 'Start a session to begin'}
            </span>
          </div>
        )}

        {messages.length === 0 && sessionActive && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 8,
              color: '#9ca3af',
            }}
          >
            <span style={{ fontSize: '1.5rem' }}>{'\u{1F916}'}</span>
            <span style={{ fontSize: '0.75rem' }}>
              Waiting for agent response...
            </span>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              marginBottom: 8,
              padding: '8px 12px',
              borderRadius: 6,
              backgroundColor:
                msg.role === 'user'
                  ? '#ecfdf5'
                  : msg.role === 'agent'
                    ? '#f9fafb'
                    : '#fef3c7',
              border:
                msg.role === 'system'
                  ? '1px solid #fde68a'
                  : '1px solid #e5e7eb',
              maxWidth: '100%',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color:
                    msg.role === 'user'
                      ? '#059669'
                      : msg.role === 'agent'
                        ? '#374151'
                        : '#92400e',
                }}
              >
                {msg.role === 'user' ? 'You' : msg.role === 'agent' ? 'Agent' : 'System'}
              </span>
              <span
                style={{
                  fontSize: '0.58rem',
                  color: '#9ca3af',
                }}
              >
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: '0.72rem',
                fontFamily: 'system-ui, sans-serif',
                color: '#1f2937',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.5,
              }}
            >
              {msg.content}
            </pre>
          </div>
        ))}
      </div>

      {/* Message input */}
      {sessionActive && (
        <div
          style={{
            borderTop: '1px solid #e5e7eb',
            padding: '8px 12px',
            backgroundColor: '#f9fafb',
            flexShrink: 0,
            display: 'flex',
            gap: 8,
          }}
        >
          <input
            type="text"
            placeholder="Type a message..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              fontSize: '0.78rem',
              fontFamily: 'system-ui, sans-serif',
            }}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!inputValue.trim() || sending}
            style={{
              padding: '7px 14px',
              borderRadius: 4,
              border: 'none',
              backgroundColor:
                !inputValue.trim() || sending ? '#d1d5db' : '#059669',
              color: '#ffffff',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor:
                !inputValue.trim() || sending ? 'not-allowed' : 'pointer',
            }}
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      )}
    </div>
  );
};

export default AgentSessionPanel;
