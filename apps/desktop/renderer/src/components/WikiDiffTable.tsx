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
 *
 * When the user clicks "Apply Selected", the table calls onApplySelected
 * with the filtered operation list so the parent can write a temporary
 * diff file and invoke the CLI apply command.
 */

import React, { useState, useCallback, useMemo } from 'react';
import type { WikiDiffOperation as WikiDiffOp } from '../types/inspector.js';
import {
  wikiDiffOperationKey,
  filterWikiDiffOperations,
} from '../utils/wiki-diff-selection.js';
import WikiDiffOperation from './WikiDiffOperation.js';

interface WikiDiffTableProps {
  /** The list of wiki-diff operations to display. */
  operations: WikiDiffOp[];
  /** Called when checked operations change. Receives the list of checked operation keys. */
  onCheckedChange: (checkedOperationKeys: string[]) => void;
  /**
   * Called when the user clicks "Apply Selected".
   *
   * Receives the filtered list of selected operations. The parent should
   * use this list to write a temporary diff file (via writeWikiDiffTempFile)
   * and then invoke `openadab wiki apply-diff --file <temp>`.
   */
  onApplySelected?: (filteredOps: WikiDiffOp[]) => void;
}

const WikiDiffTable: React.FC<WikiDiffTableProps> = ({
  operations,
  onCheckedChange,
  onApplySelected,
}) => {
  const [checkedSet, setCheckedSet] = useState<Set<string>>(() => {
    // Default: all checked
    return new Set(operations.map((op) => wikiDiffOperationKey(op)));
  });

  const allChecked = useMemo(
    () => checkedSet.size === operations.length && operations.length > 0,
    [checkedSet, operations.length],
  );

  const filteredOps = useMemo(
    () => filterWikiDiffOperations(operations, Array.from(checkedSet)),
    [operations, checkedSet],
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

  const handleApplySelected = useCallback(() => {
    if (onApplySelected && filteredOps.length > 0) {
      onApplySelected(filteredOps);
    }
  }, [onApplySelected, filteredOps]);

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
      {/* Header with select-all and apply */}
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
        {onApplySelected && (
          <button
            onClick={handleApplySelected}
            disabled={filteredOps.length === 0}
            style={{
              marginLeft: 8,
              padding: '3px 10px',
              borderRadius: 3,
              border: '1px solid #22c55e',
              backgroundColor: filteredOps.length > 0 ? '#f0fdf4' : '#f9fafb',
              color: filteredOps.length > 0 ? '#166534' : '#9ca3af',
              fontSize: '0.65rem',
              fontWeight: 600,
              cursor: filteredOps.length > 0 ? 'pointer' : 'not-allowed',
              opacity: filteredOps.length > 0 ? 1 : 0.5,
            }}
          >
            Apply Selected
          </button>
        )}
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
