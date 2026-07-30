import { PassThrough } from 'node:stream';
import inquirer from 'inquirer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRawDiff } from '../../src/core/DiffValidator.js';
import { formatConfigSchema } from '../../src/types/config.js';
import { ReviewUI } from '../../src/ui/ReviewUI.js';
import { UserCancelError } from '../../src/utils/errors.js';
import { MULTI_AREA_DIFF } from '../fixtures/diffs.js';

/**
 * The real ReviewUI driven by the real inquirer, over fake streams.
 *
 * `ReviewUI.test.ts` mocks inquirer, so it validates our logic but not the
 * question objects we hand to the library — which is exactly how the `list`
 * to `select` rename slipped past a green suite. This closes that gap.
 */

const ENTER = '\r';
const DOWN = '[B';

const format = formatConfigSchema.parse({});
const diff = parseRawDiff(MULTI_AREA_DIFF);
const group = {
  type: 'feat',
  scope: 'auth',
  description: 'add login endpoint',
  files: ['src/controllers/auth.controller.ts'],
};

let input: PassThrough;

/** Send keystrokes once the prompt has had time to render. */
function type(...keys: string[]): void {
  let delay = 60;
  for (const key of keys) {
    setTimeout(() => input.write(key), delay);
    delay += 60;
  }
}

beforeEach(() => {
  input = new PassThrough();
  const output = new PassThrough();
  output.resume();

  // Route ReviewUI's prompts through streams we control, keeping the real
  // inquirer implementation underneath.
  const module = inquirer.createPromptModule({ input, output });
  vi.spyOn(inquirer, 'prompt').mockImplementation(module as unknown as typeof inquirer.prompt);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  input.destroy();
  vi.restoreAllMocks();
});

describe('reviewSingle against the real library', () => {
  it('accepts on the first choice', async () => {
    const ui = new ReviewUI(format);
    type(ENTER);

    const result = await ui.reviewSingle(group, diff, { regenerate: async () => group });

    expect(result.description).toBe('add login endpoint');
  });

  it('cancels on the last choice', async () => {
    const ui = new ReviewUI(format);
    // Accept, Edit, Regenerate, Cancel — three moves down, then Enter.
    type(DOWN, DOWN, DOWN, ENTER);

    await expect(
      ui.reviewSingle(group, diff, { regenerate: async () => group }),
    ).rejects.toBeInstanceOf(UserCancelError);
  });
});

describe('reviewPlan against the real library', () => {
  it('skips the first commit and accepts the second', async () => {
    const ui = new ReviewUI(format);
    const plan = [
      group,
      { ...group, scope: 'config', description: 'tune eslint', files: ['.eslintrc.json'] },
    ];

    // Commit 1/2 — Accept, Edit, Merge, Skip, Cancel: three down to Skip.
    type(DOWN, DOWN, DOWN, ENTER);
    // Commit 2/2 — no Merge on the last one, so Accept is already highlighted.
    setTimeout(() => input.write(ENTER), 400);

    const confirmed = await ui.reviewPlan(plan, diff, { regenerate: async () => group });

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.scope).toBe('config');
  });
});

describe('confirm against the real library', () => {
  it('reads a plain yes', async () => {
    type(ENTER);
    await expect(new ReviewUI(format).confirm('Create commit?')).resolves.toBe(true);
  });

  it('reads an explicit no', async () => {
    type('n', ENTER);
    await expect(new ReviewUI(format).confirm('Create commit?')).resolves.toBe(false);
  });
});

describe('editGroup against the real library', () => {
  it('walks the type, scope and description prompts', async () => {
    const scoped = formatConfigSchema.parse({ scopes: ['auth', 'api'] });
    const ui = new ReviewUI(scoped);

    // The type list opens on the current value (`feat`), so one move down
    // lands on `bug`. Scope: keep `auth`. Description: type a new one.
    type(DOWN, ENTER, ENTER, 'fix login redirect', ENTER);

    const edited = await ui.editGroup(group);

    expect(edited.type).toBe('bug');
    expect(edited.scope).toBe('auth');
    expect(edited.description).toBe('fix login redirect');
  });
});
