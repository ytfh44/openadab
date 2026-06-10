/**
 * Unit tests validating all core command definitions against the CommandDef schema.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { CommandDefSchema } from '../schemas/command-def.js';

const commandsDir = join(import.meta.dirname);

function listYamlFiles(): string[] {
  return readdirSync(commandsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
}

describe('Core command definitions', () => {
  const files = listYamlFiles();

  it('has at least one command definition', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`validates ${file} against CommandDefSchema`, () => {
      const raw = readFileSync(join(commandsDir, file), 'utf-8');
      const parsed = YAML.parse(raw);
      const result = CommandDefSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new Error(`Validation failed for ${file}: ${issues}`);
      }
      expect(result.data.name).toBeTruthy();
      expect(result.data.steps.length).toBeGreaterThan(0);
    });
  }
});
