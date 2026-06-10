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
