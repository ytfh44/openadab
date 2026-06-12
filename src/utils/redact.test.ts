/**
 * Unit tests for config value redaction.
 *
 * The CLI log writer must never persist plaintext tokens / API keys /
 * passwords entered via `openadab config set`. The redaction policy
 * lives in `src/utils/redact.ts` and is exercised end-to-end via the
 * `config set` CLI command in `log-and-config.test.ts`; this file
 * covers the pure helpers directly.
 */
import { describe, it, expect } from 'vitest';

import { isSensitiveConfigPath, redactConfigValue, REDACTED_VALUE } from './redact.js';

describe('isSensitiveConfigPath', () => {
  it('marks secrets.* as sensitive', () => {
    expect(isSensitiveConfigPath('secrets.apiKey')).toBe(true);
    expect(isSensitiveConfigPath('secrets.token')).toBe(true);
    expect(isSensitiveConfigPath('secrets.openai.password')).toBe(true);
  });

  it('marks secret.* (singular) as sensitive', () => {
    expect(isSensitiveConfigPath('secret.apiKey')).toBe(true);
  });

  it('matches the secrets segment case-insensitively', () => {
    expect(isSensitiveConfigPath('Secrets.apiKey')).toBe(true);
    expect(isSensitiveConfigPath('API.SECRETS.token')).toBe(true);
  });

  it('marks leaf key "token" as sensitive', () => {
    expect(isSensitiveConfigPath('api.token')).toBe(true);
    expect(isSensitiveConfigPath('token')).toBe(true);
  });

  it('marks leaf key "apiKey" as sensitive', () => {
    expect(isSensitiveConfigPath('openai.apiKey')).toBe(true);
  });

  it('marks leaf key "password" as sensitive', () => {
    expect(isSensitiveConfigPath('database.password')).toBe(true);
  });

  it('marks leaf key "privateKey" as sensitive', () => {
    expect(isSensitiveConfigPath('signing.privateKey')).toBe(true);
  });

  it('does NOT mark "project.pov" as sensitive', () => {
    expect(isSensitiveConfigPath('project.pov')).toBe(false);
  });

  it('does NOT mark a non-leaf "token" path as sensitive (e.g. token.budget)', () => {
    expect(isSensitiveConfigPath('token.budget')).toBe(false);
  });

  it('does NOT mark a path whose leaf merely contains the substring "token"', () => {
    // leaf is "tokenType" — must not be redacted by leaf-key alone
    expect(isSensitiveConfigPath('api.tokenType')).toBe(false);
  });
});

describe('redactConfigValue', () => {
  it('redacts secrets.apiKey to the placeholder', () => {
    expect(redactConfigValue('secrets.apiKey', 'sk-xxx')).toBe(REDACTED_VALUE);
  });

  it('redacts api.token to the placeholder', () => {
    expect(redactConfigValue('api.token', 'bearer-abc')).toBe(REDACTED_VALUE);
  });

  it('redacts nested database.secrets.password', () => {
    expect(redactConfigValue('database.secrets.password', 'p4ssw0rd')).toBe(REDACTED_VALUE);
  });

  it('redacts an object value under a sensitive path', () => {
    expect(redactConfigValue('secrets', { apiKey: 'k', token: 't' })).toBe(REDACTED_VALUE);
  });

  it('keeps a normal project.pov value verbatim', () => {
    expect(redactConfigValue('project.pov', 'first-person')).toBe('first-person');
  });

  it('keeps a numeric context.maxTokens value verbatim', () => {
    expect(redactConfigValue('context.maxTokens', 18000)).toBe(18000);
  });

  it('keeps a boolean archive.backupOnOverwrite value verbatim', () => {
    expect(redactConfigValue('archive.backupOnOverwrite', true)).toBe(true);
  });

  it('keeps a deeply nested non-sensitive object verbatim (object reference preserved)', () => {
    const value = { foo: 'bar' };
    expect(redactConfigValue('project.title', value)).toBe(value);
  });

  it('the placeholder string is the literal "***"', () => {
    expect(REDACTED_VALUE).toBe('***');
  });
});
