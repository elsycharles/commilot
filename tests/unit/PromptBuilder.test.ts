import { describe, expect, it } from 'vitest';
import { parseRawDiff } from '../../src/core/DiffValidator.js';
import { PromptBuilder, renderDiff, selectStrategy } from '../../src/providers/PromptBuilder.js';
import { formatConfigSchema } from '../../src/types/config.js';
import { MULTI_AREA_DIFF, SIMPLE_DIFF, bigDiff } from '../fixtures/diffs.js';

const format = formatConfigSchema.parse({});

describe('selectStrategy (spec §6.2)', () => {
  it('sends the full diff up to 500 changed lines', () => {
    expect(selectStrategy(1)).toBe('full');
    expect(selectStrategy(500)).toBe('full');
  });

  it('summarises hunks between 501 and 2000 lines', () => {
    expect(selectStrategy(501)).toBe('summarised');
    expect(selectStrategy(2000)).toBe('summarised');
  });

  it('drops to file stats above 2000 lines', () => {
    expect(selectStrategy(2001)).toBe('stats-only');
  });
});

describe('renderDiff', () => {
  it('passes the raw diff through in full mode', () => {
    const diff = parseRawDiff(SIMPLE_DIFF);
    expect(renderDiff(diff, 'full')).toContain('@@');
  });

  it('truncates hunks in summarised mode', () => {
    const diff = parseRawDiff(bigDiff(600));
    const rendered = renderDiff(diff, 'summarised');
    expect(rendered).toContain('src/big.ts');
    expect(rendered.split('\n').length).toBeLessThan(20);
  });

  it('emits only names and stats in stats-only mode', () => {
    const diff = parseRawDiff(bigDiff(3000));
    const rendered = renderDiff(diff, 'stats-only');
    expect(rendered).toContain('src/big.ts');
    expect(rendered).not.toContain('const value1 =');
  });
});

describe('buildGeneratePrompt', () => {
  const diff = parseRawDiff(SIMPLE_DIFF);

  it('states the template, the allowed types and the length budget', () => {
    const { system } = new PromptBuilder(format).buildGeneratePrompt(diff);
    expect(system).toContain('{type}({scope}) - {description}');
    expect(system).toContain('dev, feat, bug');
    expect(system).toContain('max 72 chars');
    expect(system).toContain('MUST NOT end with a period');
  });

  it('includes positive and negative examples', () => {
    const { system } = new PromptBuilder(format).buildGeneratePrompt(diff);
    expect(system).toContain('Examples of good output');
    expect(system).toContain('Examples of BAD output');
  });

  it('lists configured scopes and drops the free-inference rule', () => {
    const scoped = formatConfigSchema.parse({ scopes: ['auth', 'api'] });
    const { system } = new PromptBuilder(scoped).buildGeneratePrompt(diff);
    expect(system).toContain('scope MUST be one of: auth, api');
  });

  it('asks the AI to infer a scope when none are configured', () => {
    const { system } = new PromptBuilder(format).buildGeneratePrompt(diff);
    expect(system).toContain('inferred from the changed code');
  });

  it('carries the configured language', () => {
    const french = formatConfigSchema.parse({ language: 'fr' });
    const { system } = new PromptBuilder(french).buildGeneratePrompt(diff);
    expect(system).toContain('ISO 639-1): fr');
  });

  it('applies the language to custom fields too, but not to fixed values', () => {
    const french = formatConfigSchema.parse({
      language: 'fr',
      template: '{type}({scope}) - {description} [{resume}] {area}',
      fields: {
        resume: { description: 'a summary' },
        area: { description: 'the area', values: ['frontend', 'backend'] },
      },
    });

    const { system } = new PromptBuilder(french).buildGeneratePrompt(diff);
    const rule = system.split('\n').find((line) => line.includes('ISO 639-1')) ?? '';

    expect(rule).toContain('"description"');
    expect(rule).toContain('"resume"');
    // Identifiers and values the user fixed must survive untranslated.
    expect(rule).not.toContain('"area"');
    expect(rule).not.toContain('"type"');
    expect(rule).not.toContain('"scope"');
  });

  it('puts the diff in the user prompt', () => {
    const { user, strategy } = new PromptBuilder(format).buildGeneratePrompt(diff);
    expect(strategy).toBe('full');
    expect(user).toContain('src/services/auth.service.ts');
  });
});

describe('buildSplitPrompt', () => {
  const diff = parseRawDiff(MULTI_AREA_DIFF);

  it('constrains the group count and file assignment', () => {
    const { system } = new PromptBuilder(format).buildSplitPrompt(diff, 4);
    expect(system).toContain('Maximum 4 groups');
    expect(system).toContain('exactly one group');
    expect(system).toContain('only appear in ONE group');
  });

  it('enumerates the exact file paths of the diff', () => {
    const { system } = new PromptBuilder(format).buildSplitPrompt(diff, 10);
    for (const file of diff.files) expect(system).toContain(file.path);
  });

  it('requests a JSON array', () => {
    const { system } = new PromptBuilder(format).buildSplitPrompt(diff, 10);
    expect(system).toContain('valid JSON array');
  });
});
