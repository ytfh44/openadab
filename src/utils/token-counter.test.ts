import { describe, it, expect } from 'vitest';

import { estimateTokens } from './token-counter.js';

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should estimate English text with chars/4 rounded up', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
    expect(estimateTokens('a'.repeat(101))).toBe(26);
  });

  it('should estimate Chinese text with chars/1.5 rounded up', () => {
    expect(estimateTokens('中文测试', 'zh')).toBe(3); // 4 chars / 1.5 = 2.67 -> 3
    expect(estimateTokens('中', 'zh')).toBe(1);
    expect(estimateTokens('中文', 'zh')).toBe(2); // 2 chars / 1.5 = 1.33 -> 2
  });

  it('should default to English when language omitted', () => {
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('should handle mixed content as English by default', () => {
    expect(estimateTokens('hello世界')).toBe(2); // 7 chars / 4 = 1.75 -> 2
  });

  it('should handle very long English text', () => {
    const text = 'word '.repeat(1000);
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });

  it('should handle very long Chinese text', () => {
    const text = '词'.repeat(1000);
    expect(estimateTokens(text, 'zh')).toBe(Math.ceil(1000 / 1.5));
  });
});
