import { describe, it, expect } from 'vitest';

import {
  AdabError,
  ConfigValidationError,
  SchemaValidationError,
  CycleDetectedError,
  WikiDiffParseError,
  TargetNotFoundError,
  ChangeStatusError,
  UnresolvedVariableError,
  TemplateNotFoundError,
  MissingSourceError,
  UsageError,
} from './errors.js';

describe('AdabError', () => {
  it('should set message and code', () => {
    const err = new AdabError('something went wrong', 'TEST_CODE');
    expect(err.message).toBe('something went wrong');
    expect(err.code).toBe('TEST_CODE');
    expect(err.name).toBe('AdabError');
  });

  it('should be an instance of Error', () => {
    const err = new AdabError('x', 'X');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ConfigValidationError', () => {
  it('should have correct code and name', () => {
    const err = new ConfigValidationError('bad config');
    expect(err.message).toBe('bad config');
    expect(err.code).toBe('CONFIG_VALIDATION_ERROR');
    expect(err.name).toBe('ConfigValidationError');
    expect(err).toBeInstanceOf(AdabError);
  });
});

describe('SchemaValidationError', () => {
  it('should have correct code and name', () => {
    const err = new SchemaValidationError('bad schema');
    expect(err.code).toBe('SCHEMA_VALIDATION_ERROR');
    expect(err.name).toBe('SchemaValidationError');
    expect(err).toBeInstanceOf(AdabError);
  });
});

describe('CycleDetectedError', () => {
  it('should have correct code and name', () => {
    const err = new CycleDetectedError('cycle!');
    expect(err.code).toBe('CYCLE_DETECTED');
    expect(err.name).toBe('CycleDetectedError');
    expect(err).toBeInstanceOf(AdabError);
  });
});

describe('WikiDiffParseError', () => {
  it('should have correct code and name', () => {
    const err = new WikiDiffParseError('parse fail');
    expect(err.code).toBe('WIKI_DIFF_PARSE_ERROR');
    expect(err.name).toBe('WikiDiffParseError');
    expect(err).toBeInstanceOf(AdabError);
  });
});

describe('TargetNotFoundError', () => {
  it('should have correct code and name', () => {
    const err = new TargetNotFoundError('missing');
    expect(err.code).toBe('TARGET_NOT_FOUND');
    expect(err.name).toBe('TargetNotFoundError');
    expect(err).toBeInstanceOf(AdabError);
  });
});

describe('ChangeStatusError', () => {
  it('should have correct code and name', () => {
    const err = new ChangeStatusError('bad transition');
    expect(err.code).toBe('CHANGE_STATUS_ERROR');
    expect(err.name).toBe('ChangeStatusError');
    expect(err).toBeInstanceOf(AdabError);
  });
});

describe('UnresolvedVariableError', () => {
  it('should have correct code and name', () => {
    const err = new UnresolvedVariableError('var missing');
    expect(err.code).toBe('UNRESOLVED_VARIABLE');
    expect(err.name).toBe('UnresolvedVariableError');
    expect(err).toBeInstanceOf(AdabError);
  });
});

describe('TemplateNotFoundError', () => {
  it('should have correct code and name', () => {
    const err = new TemplateNotFoundError('tmpl missing');
    expect(err.code).toBe('TEMPLATE_NOT_FOUND');
    expect(err.name).toBe('TemplateNotFoundError');
    expect(err).toBeInstanceOf(AdabError);
  });
});

describe('MissingSourceError', () => {
  it('should have correct code and name', () => {
    const err = new MissingSourceError('no source');
    expect(err.code).toBe('MISSING_SOURCE');
    expect(err.name).toBe('MissingSourceError');
    expect(err).toBeInstanceOf(AdabError);
  });
});

describe('UsageError', () => {
  it('has the USAGE_ERROR code and UsageError name', () => {
    const err = new UsageError('bad input');
    expect(err.code).toBe('USAGE_ERROR');
    expect(err.name).toBe('UsageError');
    expect(err.message).toBe('bad input');
    expect(err).toBeInstanceOf(AdabError);
    expect(err).toBeInstanceOf(Error);
  });

  it('is recognised as a usage error by the handleError exit-code rule', () => {
    // Mirrors the rule in cli/index.ts: USAGE_ERROR -> exit code 2.
    const err = new UsageError('x');
    expect(err.code === 'USAGE_ERROR').toBe(true);
  });

  it('preserves the cause chain when provided', () => {
    const cause = new Error('underlying');
    const err = new UsageError('bad arg', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('AdabError.toJSON serialisation', () => {
  it('JSON.stringify of a base AdabError includes name, code, and message', () => {
    const err = new AdabError('boom', 'TEST_CODE');
    const parsed = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    expect(parsed.name).toBe('AdabError');
    expect(parsed.code).toBe('TEST_CODE');
    expect(parsed.message).toBe('boom');
  });

  it('JSON.stringify of a subclass preserves the subclass name (not the base)', () => {
    const err = new ConfigValidationError('bad config');
    const parsed = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    expect(parsed.name).toBe('ConfigValidationError');
    expect(parsed.code).toBe('CONFIG_VALIDATION_ERROR');
    expect(parsed.message).toBe('bad config');
  });

  it('JSON.stringify of a UsageError includes the USAGE_ERROR code so JSON consumers can branch on it', () => {
    const err = new UsageError('invalid flag');
    const parsed = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    expect(parsed.name).toBe('UsageError');
    expect(parsed.code).toBe('USAGE_ERROR');
  });
});
