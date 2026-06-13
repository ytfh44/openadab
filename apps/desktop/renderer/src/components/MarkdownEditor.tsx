/**
 * MarkdownEditor — textarea-based markdown editor with line numbers.
 *
 * Renders a monospace textarea alongside a read-only line-number gutter.
 * Intended for the left pane of the split editor view.
 */

import React, { useRef, useCallback, useLayoutEffect, useState } from 'react';

interface MarkdownEditorProps {
  /** Controlled content value. */
  value: string;
  /** Called on every keystroke. */
  onChange: (value: string) => void;
  /** If true, the textarea is disabled. */
  disabled?: boolean;
  /** Placeholder text when the editor is empty. */
  placeholder?: string;
  /** Callback when Ctrl+S / Cmd+S is pressed. */
  onSave?: () => void;
}

const GUTTER_WIDTH = 42;

/**
 * Calculate the number of lines in a string.
 */
function countLines(text: string): number {
  if (text === '') return 1;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  return count;
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  disabled = false,
  placeholder = 'Write markdown...',
  onSave,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [lineCount, setLineCount] = useState(() => countLines(value));

  useLayoutEffect(() => {
    setLineCount(countLines(value));
  }, [value]);

  // Sync scroll between textarea and gutter
  const handleScroll = useCallback(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (onSave && (e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave();
      }
    },
    [onSave],
  );

  /** Tab key inserts 2 spaces instead of moving focus. */
  const handleKeyDownTab = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newValue = value.slice(0, start) + '  ' + value.slice(end);
        onChange(newValue);
        // Restore cursor position after the inserted spaces
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [value, onChange],
  );

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        fontFamily: 'monospace',
        position: 'relative',
      }}
    >
      {/* Line number gutter */}
      <div
        ref={gutterRef}
        aria-hidden
        style={{
          width: GUTTER_WIDTH,
          overflow: 'hidden',
          backgroundColor: '#f3f4f6',
          borderRight: '1px solid #e5e7eb',
          padding: '10px 0',
          fontSize: '0.72rem',
          lineHeight: '1.6',
          color: '#9ca3af',
          textAlign: 'right',
          userSelect: 'none',
          pointerEvents: 'none',
          whiteSpace: 'pre',
        }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            style={{
              paddingRight: 8,
              minHeight: '1.6em',
            }}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onKeyDown={(e) => {
          handleKeyDown(e);
          handleKeyDownTab(e);
        }}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          flex: 1,
          resize: 'none',
          border: 'none',
          outline: 'none',
          padding: '10px 12px',
          fontSize: '0.78rem',
          lineHeight: '1.6',
          fontFamily: 'monospace',
          color: '#1f2937',
          backgroundColor: '#fff',
          tabSize: 2,
          whiteSpace: 'pre',
          overflowWrap: 'normal',
          overflowX: 'auto',
        }}
      />
    </div>
  );
};

export default MarkdownEditor;
