/**
 * StatusIndicators — shared visual state indicators for the entire application.
 *
 * Provides consistent rendering of:
 * - Empty state (no data placeholder)
 * - Loading state (spinner/skeleton)
 * - Error state (error banner with retry)
 * - Dirty state (unsaved changes indicator)
 * - Status dots: blocked (red), ready (amber), done (green)
 * - Status badges: synced, archived
 * - Permission-pending banner
 *
 * These are reusable building blocks. Routes and components use them
 * to ensure a consistent visual language across the entire app.
 */

import React from 'react';

// ─── Status Dot ─────────────────────────────────────────────

export type StatusDotVariant = 'blocked' | 'ready' | 'done' | 'optional' | 'synced' | 'archived';

const STATUS_DOT_CONFIG: Record<
  StatusDotVariant,
  { dot: string; bg: string; border: string; text: string; label: string }
> = {
  blocked: {
    dot: '#ef4444',
    bg: '#fef2f2',
    border: '#fecaca',
    text: '#991b1b',
    label: 'Blocked',
  },
  ready: {
    dot: '#f59e0b',
    bg: '#fffbeb',
    border: '#fde68a',
    text: '#92400e',
    label: 'Ready',
  },
  done: {
    dot: '#22c55e',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    text: '#166534',
    label: 'Done',
  },
  optional: {
    dot: '#9ca3af',
    bg: '#f9fafb',
    border: '#e5e7eb',
    text: '#6b7280',
    label: 'Optional',
  },
  synced: {
    dot: '#6366f1',
    bg: '#eef2ff',
    border: '#c7d2fe',
    text: '#3730a3',
    label: 'Synced',
  },
  archived: {
    dot: '#8b5cf6',
    bg: '#f5f3ff',
    border: '#ddd6fe',
    text: '#5b21b6',
    label: 'Archived',
  },
};

interface StatusDotProps {
  /** The status variant. */
  variant: StatusDotVariant;
  /** Optional custom label override. */
  label?: string;
  /** Size in px. Default 10. */
  size?: number;
}

/**
 * A colored dot with optional label for status indication.
 * Used in DAG nodes, inspector cards, and change lists.
 */
export const StatusDot: React.FC<StatusDotProps> = ({
  variant,
  label,
  size = 10,
}) => {
  const config = STATUS_DOT_CONFIG[variant];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: '0.7rem',
        fontWeight: 600,
        color: config.text,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: config.dot,
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
      <span
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontSize: '0.65rem',
        }}
      >
        {label ?? config.label}
      </span>
    </span>
  );
};

// ─── Status Badge ───────────────────────────────────────────

interface StatusBadgeProps {
  /** The status variant. */
  variant: 'synced' | 'archived';
}

/**
 * A small badge pill for synced/archived states.
 * Used in change lists and artifact nodes.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ variant }) => {
  const config = STATUS_DOT_CONFIG[variant];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 8px',
        borderRadius: 10,
        backgroundColor: config.bg,
        border: `1px solid ${config.border}`,
        fontSize: '0.6rem',
        fontWeight: 600,
        color: config.text,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: config.dot,
          flexShrink: 0,
        }}
      />
      {config.label}
    </span>
  );
};

// ─── Empty State ────────────────────────────────────────────

interface EmptyStateProps {
  /** The entity type that has no data (e.g., "changes", "artifacts"). */
  entity: string;
  /** Optional suggestion for the user. */
  suggestion?: string;
  /** Optional action button label. */
  actionLabel?: string;
  /** Optional action callback. */
  onAction?: () => void;
}

/**
 * Renders a centered empty state placeholder with an icon and message.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  entity,
  suggestion,
  actionLabel,
  onAction,
}) => (
  <div
    role="status"
    aria-label={`No ${entity}`}
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 24px',
      gap: 10,
      textAlign: 'center',
    }}
  >
    <div
      aria-hidden="true"
      style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        backgroundColor: '#e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.2rem',
      }}
    >
      ○
    </div>
    <span
      style={{
        fontSize: '0.9rem',
        fontWeight: 600,
        color: '#374151',
      }}
    >
      No {entity}
    </span>
    {suggestion && (
      <span
        style={{
          fontSize: '0.78rem',
          color: '#9ca3af',
          maxWidth: 320,
        }}
      >
        {suggestion}
      </span>
    )}
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        style={{
          marginTop: 4,
          padding: '6px 16px',
          border: '1px solid #2563eb',
          borderRadius: 6,
          backgroundColor: '#eff6ff',
          color: '#2563eb',
          fontSize: '0.78rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {actionLabel}
      </button>
    )}
  </div>
);

// ─── Loading Spinner ────────────────────────────────────────

interface LoadingStateProps {
  /** Optional label. Default: "Loading…" */
  label?: string;
  /** Whether to show full-page center. Default false. */
  fullPage?: boolean;
}

/**
 * Renders a loading spinner with optional label.
 */
export const LoadingState: React.FC<LoadingStateProps> = ({
  label = 'Loading…',
  fullPage = false,
}) => (
  <div
    role="status"
    aria-label={label}
    aria-live="polite"
    style={
      fullPage
        ? {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            gap: 12,
          }
        : {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 24px',
            gap: 10,
          }
    }
  >
    <div
      aria-hidden="true"
      style={{
        width: 32,
        height: 32,
        border: '3px solid #e5e7eb',
        borderTopColor: '#2563eb',
        borderRadius: '50%',
        animation: 'openadab-spin 0.8s linear infinite',
      }}
    />
    <span
      style={{
        fontSize: '0.78rem',
        color: '#6b7280',
      }}
    >
      {label}
    </span>
    <style>{`
      @keyframes openadab-spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

// ─── Error Banner ───────────────────────────────────────────

interface ErrorBannerProps {
  /** The error message to display. */
  message: string;
  /** Optional details (shown in a collapsible section). */
  details?: string;
  /** Optional retry callback. */
  onRetry?: () => void;
  /** Optional dismiss callback. */
  onDismiss?: () => void;
}

/**
 * Renders an error banner with optional retry and dismiss actions.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  message,
  details,
  onRetry,
  onDismiss,
}) => {
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 14px',
        backgroundColor: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: 6,
        margin: 8,
      }}
    >
      {/* Main error row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            fontSize: '1rem',
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          ✗
        </span>
        <div style={{ flex: 1 }}>
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#991b1b',
            }}
          >
            Error
          </span>
          <span
            style={{
              fontSize: '0.78rem',
              color: '#7f1d1d',
              marginLeft: 8,
            }}
          >
            {message}
          </span>
        </div>
        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {details && (
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              style={{
                padding: '2px 8px',
                border: '1px solid #fca5a5',
                borderRadius: 4,
                backgroundColor: 'transparent',
                color: '#991b1b',
                fontSize: '0.68rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {showDetails ? 'Hide' : 'Details'}
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                padding: '2px 8px',
                border: '1px solid #dc2626',
                borderRadius: 4,
                backgroundColor: '#dc2626',
                color: '#fff',
                fontSize: '0.68rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Retry
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss error"
              style={{
                padding: '2px 6px',
                border: 'none',
                backgroundColor: 'transparent',
                color: '#991b1b',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Expandable details */}
      {showDetails && details && (
        <pre
          style={{
            margin: 0,
            padding: 8,
            backgroundColor: '#fff',
            border: '1px solid #fecaca',
            borderRadius: 4,
            fontSize: '0.68rem',
            color: '#991b1b',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 200,
            overflow: 'auto',
          }}
        >
          {details}
        </pre>
      )}
    </div>
  );
};

// ─── Dirty Indicator ────────────────────────────────────────

interface DirtyIndicatorProps {
  /** Whether unsaved changes exist. */
  isDirty: boolean;
  /** Optional custom label. */
  label?: string;
}

/**
 * Renders an orange dot with "Unsaved changes" text when dirty.
 */
export const DirtyIndicator: React.FC<DirtyIndicatorProps> = ({
  isDirty,
  label = 'Unsaved changes',
}) => {
  if (!isDirty) return null;

  return (
    <span
      role="status"
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: '0.68rem',
        fontWeight: 600,
        color: '#92400e',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: '#f97316',
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
};

// ─── Permission Pending Banner ──────────────────────────────

interface PermissionPendingBannerProps {
  /** The capability being requested. */
  capability: string;
  /** Optional detail message. */
  detail?: string;
}

/**
 * Renders a yellow banner for permission-pending state.
 * Used in PermissionModal and AgentDock when a permission request is pending.
 */
export const PermissionPendingBanner: React.FC<
  PermissionPendingBannerProps
> = ({ capability, detail }) => (
  <div
    role="status"
    aria-label="Permission pending"
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: '8px 12px',
      backgroundColor: '#fefce8',
      border: '1px solid #fde68a',
      borderRadius: 6,
      margin: '0 8px',
    }}
  >
    <span
      aria-hidden="true"
      style={{
        fontSize: '0.9rem',
        flexShrink: 0,
        marginTop: 1,
      }}
    >
      ⚠
    </span>
    <div>
      <span
        style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          color: '#92400e',
        }}
      >
        Permission Required
      </span>
      <span
        style={{
          fontSize: '0.72rem',
          color: '#a16207',
          marginLeft: 8,
        }}
      >
        {capability}
      </span>
      {detail && (
        <div
          style={{
            fontSize: '0.65rem',
            color: '#a16207',
            marginTop: 2,
          }}
        >
          {detail}
        </div>
      )}
    </div>
  </div>
);

// ─── Status Indicator Row (composite) ───────────────────────

interface StatusIndicatorRowProps {
  /** The artifact/workflow status. */
  status: 'blocked' | 'ready' | 'done' | 'optional';
  /** Whether the change is synced. */
  isSynced?: boolean;
  /** Whether the change is archived. */
  isArchived?: boolean;
}

/**
 * Composite status row showing dot + synced/archived badges.
 * Used in ChangeSelector and other change overview components.
 */
export const StatusIndicatorRow: React.FC<StatusIndicatorRowProps> = ({
  status,
  isSynced = false,
  isArchived = false,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    }}
  >
    <StatusDot variant={status} />
    {isSynced && <StatusBadge variant="synced" />}
    {isArchived && <StatusBadge variant="archived" />}
  </div>
);
