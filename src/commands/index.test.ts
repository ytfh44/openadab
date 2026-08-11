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

const files = listYamlFiles();

describe('Core command definitions', () => {

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

describe('Core command definitions contract', () => {
  const defs = files.map((file) => {
    const raw = readFileSync(join(commandsDir, file), 'utf-8');
    const parsed = YAML.parse(raw);
    const result = CommandDefSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Validation failed for ${file}: ${issues}`);
    }
    return { file, def: result.data };
  });

  const stepTexts = (def: typeof defs[number]['def']): string[] =>
    def.steps.flatMap((s) => [s.command, s.paths, s.path, s.content]).filter((v): v is string => v !== undefined);

  it('every step placeholder resolves to a declared parameter, a captured output, or llm_output', () => {
    for (const { file, def } of defs) {
      const paramNames = new Set(def.parameters.map((p) => p.name));
      const captureNames = new Set(def.steps.map((s) => s.capture).filter((c): c is string => c !== undefined));
      captureNames.add('llm_output');
      for (const text of stepTexts(def)) {
        for (const match of text.matchAll(/\{\{(\w+(?:\.\w+)*)\}\}/g)) {
          const topKey = match[1].split('.')[0];
          expect(
            paramNames.has(topKey) || captureNames.has(topKey),
            `${file}: placeholder {{${match[1]}}} in \`${text}\` references undeclared \`${topKey}\``
          ).toBe(true);
        }
      }
    }
  });

  it('every declared parameter is interpolated in at least one step', () => {
    for (const { file, def } of defs) {
      const used = new Set<string>();
      for (const text of stepTexts(def)) {
        for (const match of text.matchAll(/\{\{(\w+(?:\.\w+)*)\}\}/g)) {
          used.add(match[1].split('.')[0]);
        }
      }
      for (const p of def.parameters) {
        expect(used.has(p.name), `${file}: parameter \`${p.name}\` is declared but never interpolated in any step`).toBe(true);
      }
    }
  });
});
