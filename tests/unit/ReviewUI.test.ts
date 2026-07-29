import { beforeEach, describe, expect, it, vi } from 'vitest';

// inquirer is replaced by a queue of scripted answers.
const answers: unknown[] = [];
const promptMock = vi.fn(async (_questions: unknown): Promise<unknown> => {
  if (answers.length === 0) throw new Error('no scripted answer left');
  return answers.shift();
});

vi.mock('inquirer', () => ({
  default: {
    prompt: promptMock,
    Separator: class Separator {
      readonly type = 'separator';
    },
  },
}));

const { ReviewUI } = await import('../../src/ui/ReviewUI.js');
const { parseRawDiff } = await import('../../src/core/DiffValidator.js');
const { formatConfigSchema } = await import('../../src/types/config.js');
const { UserCancelError } = await import('../../src/utils/errors.js');
const { MULTI_AREA_DIFF } = await import('../fixtures/diffs.js');

const format = formatConfigSchema.parse({});
const diff = parseRawDiff(MULTI_AREA_DIFF);

const group = (
  over: Partial<{ type: string; scope: string; description: string; files: string[] }> = {},
) => ({
  type: 'feat',
  scope: 'auth',
  description: 'add login endpoint',
  files: ['src/controllers/auth.controller.ts'],
  ...over,
});

const plan = [
  group(),
  group({
    scope: 'dashboard',
    description: 'add stats widget',
    files: ['src/components/stats-widget.tsx'],
  }),
  group({ type: 'dev', scope: 'config', description: 'tune eslint', files: ['.eslintrc.json'] }),
];

function script(...values: unknown[]): void {
  answers.length = 0;
  answers.push(...values);
}

beforeEach(() => {
  promptMock.mockClear();
  answers.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('reviewSingle (AC-07)', () => {
  it('returns the proposal on accept', async () => {
    script({ action: 'accept' });
    const ui = new ReviewUI(format);
    const result = await ui.reviewSingle(group(), diff, { regenerate: async () => group() });
    expect(result.description).toBe('add login endpoint');
  });

  it('replaces the proposal on regenerate, then accepts', async () => {
    script({ action: 'regenerate' }, { action: 'accept' });
    const ui = new ReviewUI(format);

    const result = await ui.reviewSingle(group(), diff, {
      regenerate: async () => group({ description: 'second attempt' }),
    });

    expect(result.description).toBe('second attempt');
    expect(promptMock).toHaveBeenCalledTimes(2);
  });

  it('applies an edit and keeps the file list', async () => {
    script(
      { action: 'edit' },
      { type: 'bug', scope: 'api', description: 'fix login redirect.' },
      { action: 'accept' },
    );
    const ui = new ReviewUI(format);

    const result = await ui.reviewSingle(group(), diff, { regenerate: async () => group() });

    expect(result).toMatchObject({ type: 'bug', scope: 'api', description: 'fix login redirect' });
    expect(result.files).toEqual(['src/controllers/auth.controller.ts']);
    expect(ui.message(result)).toBe('bug(api) - fix login redirect');
  });

  it('throws UserCancelError on cancel (AC-08)', async () => {
    script({ action: 'cancel' });
    const ui = new ReviewUI(format);
    await expect(
      ui.reviewSingle(group(), diff, { regenerate: async () => group() }),
    ).rejects.toBeInstanceOf(UserCancelError);
  });
});

describe('reviewPlan (AC-07)', () => {
  it('accepts every group in order', async () => {
    script({ action: 'accept' }, { action: 'accept' }, { action: 'accept' });
    const ui = new ReviewUI(format);

    const confirmed = await ui.reviewPlan(plan, diff, { regenerate: async () => group() });

    expect(confirmed).toHaveLength(3);
    expect(confirmed.map((entry) => entry.scope)).toEqual(['auth', 'dashboard', 'config']);
  });

  it('drops a skipped group but keeps the rest', async () => {
    script({ action: 'skip' }, { action: 'accept' }, { action: 'accept' });
    const ui = new ReviewUI(format);

    const confirmed = await ui.reviewPlan(plan, diff, { regenerate: async () => group() });

    expect(confirmed).toHaveLength(2);
    expect(confirmed.flatMap((entry) => entry.files)).not.toContain(
      'src/controllers/auth.controller.ts',
    );
  });

  it('merges two groups into one commit', async () => {
    script({ action: 'merge' }, { action: 'accept' }, { action: 'accept' });
    const ui = new ReviewUI(format);

    const confirmed = await ui.reviewPlan(plan, diff, {
      regenerate: async () => group(),
      regenerateMerged: async (files) => group({ description: 'add login and stats', files }),
    });

    expect(confirmed).toHaveLength(2);
    expect(confirmed[0]?.files).toEqual([
      'src/controllers/auth.controller.ts',
      'src/components/stats-widget.tsx',
    ]);
    expect(confirmed[0]?.description).toBe('add login and stats');
  });

  it('merges without the AI when no callback is available', async () => {
    script({ action: 'merge' }, { action: 'accept' }, { action: 'accept' });
    const ui = new ReviewUI(format);

    const confirmed = await ui.reviewPlan(plan, diff, { regenerate: async () => group() });

    expect(confirmed[0]?.files).toHaveLength(2);
    expect(confirmed[0]?.description).toContain('add login endpoint');
  });

  it('aborts the whole plan on cancel (AC-20)', async () => {
    script({ action: 'accept' }, { action: 'cancel' });
    const ui = new ReviewUI(format);

    await expect(
      ui.reviewPlan(plan, diff, { regenerate: async () => group() }),
    ).rejects.toBeInstanceOf(UserCancelError);
  });

  it('does not offer merge on the last group', async () => {
    script({ action: 'accept' }, { action: 'accept' }, { action: 'accept' });
    const ui = new ReviewUI(format);
    await ui.reviewPlan(plan, diff, { regenerate: async () => group() });

    const lastQuestion = promptMock.mock.calls.at(-1)?.[0] as
      Array<{ choices: Array<{ value: string }> }> | undefined;
    expect(lastQuestion?.[0]?.choices.map((choice) => choice.value)).not.toContain('merge');
  });
});

describe('confirm', () => {
  it('passes the answer through', async () => {
    script({ confirmed: false });
    await expect(new ReviewUI(format).confirm('Create commit?')).resolves.toBe(false);
  });

  it('treats a Ctrl-C during a prompt as a cancellation', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'ExitPromptError' });
    promptMock.mockRejectedValueOnce(abort);
    await expect(new ReviewUI(format).confirm('Create commit?')).rejects.toBeInstanceOf(
      UserCancelError,
    );
  });
});

describe('editGroup', () => {
  it('offers the configured scopes plus a custom option', async () => {
    const scoped = formatConfigSchema.parse({ scopes: ['auth', 'api'] });
    script({ type: 'feat', scope: 'other…', description: 'add thing' }, { scope: 'billing' });

    const result = await new ReviewUI(scoped).editGroup(group());

    expect(result.scope).toBe('billing');
    const question = promptMock.mock.calls[0]?.[0] as Array<{ choices?: unknown[] }> | undefined;
    expect(question?.[1]?.choices).toContain('auth');
  });
});
