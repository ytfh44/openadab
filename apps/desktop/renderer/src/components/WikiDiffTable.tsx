/**
 * WikiDiffTable — operation-by-operation review table.
 *
 * Renders a list of WikiDiffOperation rows with select-all/deselect-all
 * controls. Tracks which operations are checked for selective apply.
 *
 * Each operation row is identified by its stable operation key (target,
 * type, source) so that two operations targeting the same page can be
 * selected independently.
 *
 * Each operation renders with expandable payload, source, and warnings.
 */

import React, { useState, useCallback, useMemo } from 'react';
import type { WikiDiffOperation as WikiDiffOp } from '../types/inspector.js';
import { wikiDiffOperationKey } from '../utils/wiki-diff-selection.js';
import WikiDiffOperation from './WikiDiffOperation.js';

interface WikiDiffTableProps {
  /** The list of wiki-diff operations to display. */
  operations: WikiDiffOp[];
  /** Called when checked operations change. Receives the list of checked operation keys. */
  onCheckedChange: (checkedOperationKeys: string[]) => void;
}

const WikiDiffTable: React.FC<WikiDiffTableProps> = ({
  operations,
  onCheckedChange,
}) => {
  const [checkedSet, setCheckedSet] = useState<Set<string>>(() => {
    // Default: all checked
    return new Set(operations.map((op) => wikiDiffOperationKey(op)));
  });

  const allChecked = useMemo(
    () => checkedSet.size === operations.length && operations.length > 0,
    [checkedSet, operations.length],
  );

  const toggleOne = useCallback(
    (operationKey: string) => {
      setCheckedSet((prev) => {
        const next = new Set(prev);
        if (next.has(operationKey)) {
          next.delete(operationKey);
        } else {
          next.add(operationKey);
        }
        // Notify parent
        onCheckedChange(Array.from(next));
        return next;
      });
    },
    [onCheckedChange],
  );

  const toggleAll = useCallback(() => {
    if (allChecked) {
      setCheckedSet(new Set());
      onCheckedChange([]);
    } else {
      const all = new Set(operations.map((op) => wikiDiffOperationKey(op)));
      setCheckedSet(all);
      onCheckedChange(Array.from(all));
    }
  }, [allChecked, operations, onCheckedChange]);

  // Notify parent of initial state
  React.useEffect(() => {
    onCheckedChange(Array.from(checkedSet));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {/* Header with select-all */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          backgroundColor: '#f9fafb',
          borderBottom: '2px solid #e5e7eb',
          fontSize: '0.68rem',
          fontWeight: 600,
          color: '#374151',
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={allChecked}
            onChange={toggleAll}
            style={{ cursor: 'pointer' }}
          />
          {allChecked ? 'Deselect All' : 'Select All'}
        </label>
        <span style={{ marginLeft: 'auto', color: '#6b7280', fontWeight: 400 }}>
          {checkedSet.size} / {operations.length} selected
        </span>
      </div>

      {/* Operation rows */}
      {operations.length === 0 && (
        <div
          style={{
            padding: 20,
            textAlign: 'center',
            color: '#9ca3af',
            fontSize: '0.72rem',
          }}
        >
          No operations to display.
        </div>
      )}

      {operations.map((op) => {
        const opKey = wikiDiffOperationKey(op);
        return (
          <WikiDiffOperation
            key={opKey}
            operation={op}
            checked={checkedSet.has(opKey)}
            onToggle={() => toggleOne(opKey)}
          />
        );
      })}
    </div>
  );
};

export default WikiDiffTable;