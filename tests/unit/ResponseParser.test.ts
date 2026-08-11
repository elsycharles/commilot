import { describe, expect, it } from 'vitest';
import { parseRawDiff } from '../../src/core/DiffValidator.js';
import {
  closestMatch,
  formatCommitMessage,
  parseCommitGroup,
  parseCommitPlan,
  stripFences,
  truncateDescription,
} from '../../src/core/ResponseParser.js';
import { formatConfigSchema } from '../../src/types/config.js';
import { MalformedResponseError } from '../../src/utils/errors.js';
import { MULTI_AREA_DIFF } from '../fixtures/diffs.js';
import { GENERATE_JSON, GENERATE_JSON_FENCED, SPLIT_JSON } from '../fixtures/responses.js';

const format = formatConfigSchema.parse({});
const diff = parseRawDiff(MULTI_AREA_DIFF);

describe('stripFences', () => {
  it('unwraps markdown fences and surrounding prose', () => {
    expect(stripFences(GENERATE_JSON_FENCED)).toBe(GENERATE_JSON);
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('Sure! {"a":1} hope that helps')).toBe('{"a":1}');
  });
});

describe('parseCommitGroup', () => {
  it('parses a well-formed response', () => {
    const group = parseCommitGroup(GENERATE_JSON, format);
    expect(group).toMatchObject({
      type: 'feat',
      scope: 'auth',
      description: 'add jwt token refresh mechanism',
    });
  });

  it('parses a fenced response', () => {
    expect(parseCommitGroup(GENERATE_JSON_FENCED, format).type).toBe('feat');
  });

  it('maps an out-of-vocabulary type onto the closest allowed one (AC-04)', () => {
    const group = parseCommitGroup(
      JSON.stringify({ type: 'feature', scope: 'auth', description: 'add login' }),
      format,
    );
    expect(group.type).toBe('feat');
  });

  it('falls back to the first allowed type when nothing is close', () => {
    const group = parseCommitGroup(
      JSON.stringify({ type: 'zzzzzz', scope: 'auth', description: 'add login' }),
      format,
    );
    expect(format.types).toContain(group.type);
    expect(group.type).toBe('dev');
  });

  it('truncates an over-long description at a word boundary', () => {
    const short = formatConfigSchema.parse({ descriptionMaxLength: 20 });
    const group = parseCommitGroup(
      JSON.stringify({
        type: 'feat',
        scope: 'auth',
        description: 'add a very long description that will not fit',
      }),
      short,
    );
    expect(group.description.length).toBeLessThanOrEqual(20);
    expect(group.description.endsWith(' ')).toBe(false);
  });

  it('strips a trailing period', () => {
    const group = parseCommitGroup(
      JSON.stringify({ type: 'bug', scope: 'api', description: 'fix null crash.' }),
      format,
    );
    expect(group.description).toBe('fix null crash');
  });

  it('throws MalformedResponseError on unparseable JSON (AC-12)', () => {
    expect(() => parseCommitGroup('not json at all', format)).toThrow(MalformedResponseError);
    expect(() => parseCommitGroup('{"type": "feat"}', format)).toThrow(MalformedResponseError);
  });
});

describe('parseCommitPlan', () => {
  it('parses a split response into groups', () => {
    const plan = parseCommitPlan(SPLIT_JSON, format, diff);
    expect(plan).toHaveLength(3);
    expect(plan[0]?.files).toEqual(['src/controllers/auth.controller.ts']);
  });

  it('assigns every file exactly once (AC-21)', () => {
    const plan = parseCommitPlan(SPLIT_JSON, format, diff);
    const assigned = plan.flatMap((group) => group.files);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(assigned.sort()).toEqual(diff.files.map((file) => file.path).sort());
  });

  it('keeps the first assignment when a file is duplicated', () => {
    const raw = JSON.stringify([
      { type: 'feat', scope: 'auth', description: 'a', files: ['.eslintrc.json'] },
      { type: 'dev', scope: 'config', description: 'b', files: ['.eslintrc.json'] },
    ]);
    const plan = parseCommitPlan(raw, format, diff);
    expect(plan[0]?.files).toEqual(['.eslintrc.json']);
    // The duplicate group is dropped and the unassigned files land in a fallback.
    expect(plan.flatMap((group) => group.files).filter((f) => f === '.eslintrc.json')).toHaveLength(
      1,
    );
  });

  it('adds a fallback group for files the AI forgot', () => {
    const raw = JSON.stringify([
      {
        type: 'feat',
        scope: 'auth',
        description: 'add login',
        files: ['src/controllers/auth.controller.ts'],
      },
    ]);
    const plan = parseCommitPlan(raw, format, diff);
    const assigned = plan.flatMap((group) => group.files);
    expect(assigned).toContain('.eslintrc.json');
    expect(assigned).toContain('src/components/stats-widget.tsx');
    expect(plan.at(-1)?.scope).toBe('misc');
  });

  it('drops empty groups and files not present in the diff', () => {
    const raw = JSON.stringify([
      { type: 'feat', scope: 'auth', description: 'ghost', files: ['does/not/exist.ts'] },
      { type: 'dev', scope: 'config', description: 'real', files: ['.eslintrc.json'] },
    ]);
    const plan = parseCommitPlan(raw, format, diff);
    expect(plan.some((group) => group.description === 'ghost')).toBe(false);
  });

  it('resolves paths the model shortened to a basename', () => {
    const raw = JSON.stringify([
      { type: 'dev', scope: 'config', description: 'tune eslint', files: ['./.eslintrc.json'] },
    ]);
    const plan = parseCommitPlan(raw, format, diff);
    expect(plan[0]?.files).toEqual(['.eslintrc.json']);
  });

  it('merges the tail when the AI exceeds maxCommits', () => {
    const plan = parseCommitPlan(SPLIT_JSON, format, diff, 2);
    expect(plan).toHaveLength(2);
    expect(plan.flatMap((group) => group.files)).toHaveLength(3);
  });

  it('accepts an object wrapper around the array', () => {
    const plan = parseCommitPlan(`{"commits": ${SPLIT_JSON}}`, format, diff);
    expect(plan).toHaveLength(3);
  });

  it('throws when the payload is not a plan', () => {
    expect(() => parseCommitPlan('{"nope": true}', format, diff)).toThrow(MalformedResponseError);
  });
});

describe('custom fields', () => {
  const custom = formatConfigSchema.parse({
    template: '{type} {ticket} {area}',
    fields: {
      ticket: { description: 'the issue number' },
      area: { description: 'the area', values: ['frontend', 'backend'] },
    },
  });

  it('reads them out of the response', () => {
    const group = parseCommitGroup(
      JSON.stringify({
        type: 'feat',
        scope: 'auth',
        description: 'add login',
        ticket: 'PROJ-42',
        area: 'backend',
      }),
      custom,
    );

    expect(group.fields).toMatchObject({ ticket: 'PROJ-42', area: 'backend' });
  });

  it('maps a near miss onto an allowed value', () => {
    const group = parseCommitGroup(
      JSON.stringify({ type: 'feat', scope: '', description: 'x', ticket: '1', area: 'Backend' }),
      custom,
    );
    expect(group.fields?.area).toBe('backend');
  });

  it('leaves a field the model skipped empty rather than failing', () => {
    const group = parseCommitGroup(
      JSON.stringify({ type: 'feat', scope: '', description: 'x', area: 'frontend' }),
      custom,
    );
    expect(group.fields?.ticket).toBe('');
  });

  it('truncates a field to its own maxLength', () => {
    const short = formatConfigSchema.parse({
      template: '{note}',
      fields: { note: { maxLength: 10 } },
    });
    const group = parseCommitGroup(
      JSON.stringify({ type: 'feat', scope: '', description: 'x', note: 'a'.repeat(50) }),
      short,
    );
    expect(group.fields?.note).toHaveLength(10);
  });

  it('carries them through a split plan', () => {
    const plan = parseCommitPlan(
      JSON.stringify([
        {
          type: 'feat',
          scope: 'auth',
          description: 'add login',
          ticket: 'PROJ-7',
          area: 'backend',
          files: ['src/controllers/auth.controller.ts'],
        },
      ]),
      custom,
      diff,
    );
    expect(plan[0]?.fields).toMatchObject({ ticket: 'PROJ-7', area: 'backend' });
  });
});

describe('a catch-all group must not starve the specific ones', () => {
  it('gives each file to the group that names the fewest', () => {
    // Models routinely answer with everything in one group, then the real
    // grouping after it. Keeping whichever came first kept the catch-all and
    // dropped the rest — the "it put everything in one commit" complaint.
    const plan = parseCommitPlan(
      JSON.stringify([
        {
          type: 'dev',
          scope: 'all',
          description: 'everything at once',
          files: [
            'src/controllers/auth.controller.ts',
            'src/components/stats-widget.tsx',
            '.eslintrc.json',
          ],
        },
        {
          type: 'feat',
          scope: 'ui',
          description: 'add stats widget',
          files: ['src/components/stats-widget.tsx'],
        },
        { type: 'dev', scope: 'config', description: 'tune eslint', files: ['.eslintrc.json'] },
      ]),
      format,
      diff,
    );

    expect(plan).toHaveLength(3);
    expect(plan.find((g) => g.scope === 'ui')?.files).toEqual(['src/components/stats-widget.tsx']);
    expect(plan.find((g) => g.scope === 'config')?.files).toEqual(['.eslintrc.json']);
    // The catch-all keeps only what nothing else claimed.
    expect(plan.find((g) => g.scope === 'all')?.files).toEqual([
      'src/controllers/auth.controller.ts',
    ]);
  });

  it('drops a group whose files are all better placed', () => {
    const plan = parseCommitPlan(
      JSON.stringify([
        { type: 'dev', scope: 'dup', description: 'duplicate', files: ['.eslintrc.json'] },
        { type: 'dev', scope: 'dup2', description: 'duplicate too', files: ['.eslintrc.json'] },
      ]),
      format,
      diff,
    );

    expect(plan.filter((g) => g.files.includes('.eslintrc.json'))).toHaveLength(1);
  });
});

describe('formatCommitMessage', () => {
  it('renders the configured template', () => {
    expect(
      formatCommitMessage(
        { type: 'feat', scope: 'auth', description: 'add login', files: [] },
        format,
      ),
    ).toBe('feat(auth) - add login');
  });

  it('supports a custom template', () => {
    const custom = formatConfigSchema.parse({ template: '[{type}/{scope}] {description}' });
    expect(
      formatCommitMessage(
        { type: 'bug', scope: 'api', description: 'fix crash', files: [] },
        custom,
      ),
    ).toBe('[bug/api] fix crash');
  });

  it('drops empty parentheses when no scope was found', () => {
    expect(
      formatCommitMessage({ type: 'dev', scope: '', description: 'tidy up', files: [] }, format),
    ).toBe('dev - tidy up');
  });
});

describe('helpers', () => {
  it('finds the closest allowed value', () => {
    expect(closestMatch('Feat', ['dev', 'feat', 'bug'])).toBe('feat');
    expect(closestMatch('bugfix', ['dev', 'feat', 'bug'])).toBe('bug');
    expect(closestMatch('documentation', ['dev', 'feat', 'bug'])).toBeUndefined();
  });

  it('never returns a description longer than the budget', () => {
    expect(truncateDescription('a'.repeat(100), 10)).toHaveLength(10);
    expect(truncateDescription('short one', 72)).toBe('short one');
  });
});
