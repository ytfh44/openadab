/**
 * MarkdownPreview — simple markdown-to-HTML preview pane.
 *
 * Renders a basic HTML rendering of markdown text using a lightweight
 * inline converter. Intended for the right pane of the split editor view.
 *
 * Supports: headings (h1-h4), bold, italic, inline code, code blocks,
 * unordered lists, ordered lists, paragraphs, horizontal rules, and links.
 */

import React, { useMemo } from 'react';

/**
 * Convert a markdown string to a basic HTML string.
 *
 * This is a deliberately minimal converter designed for artifact previews.
 * It does NOT handle all CommonMark edge cases — just the most common
 * patterns used in OpenAdab artifact files.
 */
function markdownToHtml(md: string): string {
  let html = md;

  // Escape HTML entities in non-code content
  // (we handle code blocks/inline code separately)

  // Process fenced code blocks first to avoid interference
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_full, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      `<pre><code>${escapeHtml(code.trim())}</code></pre>`,
    );
    return `\x00CODEBLOCK${idx}\x00`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_m, code) => {
    return `<code>${escapeHtml(code)}</code>`;
  });

  // Headings (must come before bold/italic to avoid conflicts)
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Horizontal rules
  html = html.replace(/^(---|\*\*\*|___)$/gm, '<hr/>');

  // Ordered lists (block-level)
  html = html.replace(/^(\d+)\. (.+)$/gm, (_full, _num, text) => {
    return `<li>${text}</li>`;
  });

  // Unordered lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> in <ol>/<ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, (match) => {
    return `<ul>${match.trim()}</ul>`;
  });

  // Paragraphs: blank-line-separated blocks
  html = html.replace(/\n\n+/g, '\n</p><p>\n');
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p><h([1-4])>/g, '<h$1>');
  html = html.replace(/<\/h([1-4])><\/p>/g, '</h$1>');
  html = html.replace(/<p><pre>/g, '<pre>');
  html = html.replace(/<\/pre><\/p>/g, '</pre>');
  html = html.replace(/<p><ul>/g, '<ul>');
  html = html.replace(/<\/ul><\/p>/g, '</ul>');
  html = html.replace(/<p><hr\/><\/p>/g, '<hr/>');

  // Restore code blocks
  html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, (_m, idx) => {
    return codeBlocks[Number(idx)] ?? '';
  });

  // Handle single newlines within paragraphs as <br/>
  // (but skip blocks we already handled)
  html = html.replace(/\n/g, '<br/>');

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface MarkdownPreviewProps {
  /** Markdown source to render. */
  content: string;
  /** If true, show a placeholder message. */
  emptyMessage?: string;
}

/**
 * Right-pane markdown preview for the artifact editor.
 *
 * Converts markdown to HTML inline and renders it in a styled
 * preview container. Handles empty content gracefully.
 */
const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  emptyMessage = 'Preview will appear here…',
}) => {
  const html = useMemo(() => markdownToHtml(content), [content]);

  if (!content || content.trim().length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          color: '#9ca3af',
          fontSize: '0.82rem',
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
          textAlign: 'center',
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className="markdown-preview"
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '16px 20px',
        backgroundColor: '#fff',
        lineHeight: 1.7,
        fontSize: '0.82rem',
        color: '#1f2937',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownPreview;
