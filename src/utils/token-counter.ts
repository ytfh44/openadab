/**
 * Supported language codes for token estimation.
 */
export type TokenLanguage = 'en' | 'zh';

/**
 * Estimate the number of tokens in a text using language-specific heuristics.
 *
 * - English (`en`): characters ÷ 4
 * - Chinese (`zh`): characters ÷ 1.5
 *
 * The Chinese divisor of 1.5 aligns with GPT-family tokenizer behavior where
 * Chinese characters average ~1.5 tokens each. The English divisor of 4 is
 * the standard heuristic for whitespace-delimited text.
 *
 * Character counting uses the iterator protocol via
 * `Array.from(text).length`, which gives the number of Unicode code
 * points (UTF-16 surrogate pairs count as one).  This matches the
 * user-perceived character count for emoji, CJK extension B–G, and
 * other supplementary-plane characters, which a naive `text.length`
 * would over-count by a factor of 2.
 *
 * @param text     The input text.
 * @param language Optional language code; defaults to `'en'`.
 * @returns Estimated token count (≥ 0).
 */
export function estimateTokens(text: string, language: TokenLanguage = 'en'): number {
  if (text.length === 0) {
    return 0;
  }

  const divisor = language === 'zh' ? 1.5 : 4;
  return Math.ceil(Array.from(text).length / divisor);
}
