import { PassThrough } from 'node:stream';
import inquirer from 'inquirer';
import { describe, expect, it } from 'vitest';

/**
 * The ReviewUI tests replace inquirer with a queue of scripted answers, which
 * means they would keep passing even if inquirer's API changed completely.
 * These tests drive the real library with real keystrokes, so a major upgrade
 * cannot pass unnoticed.
 */

const ENTER = '\r';
const DOWN = '[B';

interface Driven<T> {
  answers: Promise<T>;
  output: () => string;
}

/** Run a real prompt against fake streams, sending `keys` once it renders. */
function drive<T>(questions: Parameters<typeof inquirer.prompt>[0], keys: string[]): Driven<T> {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on('data', (chunk) => chunks.push(String(chunk)));

  const module = inquirer.createPromptModule({ input, output });
  const answers = module(questions) as unknown as Promise<T>;

  // Let the prompt render before answering it.
  let delay = 40;
  for (const key of keys) {
    setTimeout(() => input.write(key), delay);
    delay += 40;
  }

  return { answers, output: () => chunks.join('') };
}

describe('inquirer select prompt (the renamed list)', () => {
  it('returns the highlighted value on Enter', async () => {
    const { answers, output } = drive<{ action: string }>(
      [
        {
          type: 'select',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: 'Accept and commit', value: 'accept' },
            { name: 'Edit message', value: 'edit' },
            { name: 'Cancel', value: 'cancel' },
          ],
        },
      ],
      [ENTER],
    );

    await expect(answers).resolves.toEqual({ action: 'accept' });
    expect(output()).toContain('What would you like to do?');
  });

  it('moves down before answering', async () => {
    const { answers } = drive<{ action: string }>(
      [
        {
          type: 'select',
          name: 'action',
          message: 'Pick',
          choices: [
            { name: 'first', value: 'accept' },
            { name: 'second', value: 'edit' },
          ],
        },
      ],
      [DOWN, ENTER],
    );

    await expect(answers).resolves.toEqual({ action: 'edit' });
  });

  it('preselects the value passed as default', async () => {
    // editGroup relies on this to keep the current type highlighted.
    const { answers } = drive<{ type: string }>(
      [
        {
          type: 'select',
          name: 'type',
          message: 'Type:',
          choices: ['dev', 'feat', 'bug'],
          default: 'bug',
        },
      ],
      [ENTER],
    );

    await expect(answers).resolves.toEqual({ type: 'bug' });
  });

  it('renders a Separator among the choices', async () => {
    const { answers, output } = drive<{ scope: string }>(
      [
        {
          type: 'select',
          name: 'scope',
          message: 'Scope:',
          choices: ['auth', 'api', new inquirer.Separator(), 'other…'],
        },
      ],
      [ENTER],
    );

    await expect(answers).resolves.toEqual({ scope: 'auth' });
    expect(output()).toContain('auth');
  });
});

describe('inquirer input prompt', () => {
  it('accepts typed text and applies the default', async () => {
    const { answers } = drive<{ description: string }>(
      [
        {
          type: 'input',
          name: 'description',
          message: 'Description:',
          default: 'add login endpoint',
        },
      ],
      [ENTER],
    );

    await expect(answers).resolves.toEqual({ description: 'add login endpoint' });
  });

  it('rejects a value the validator refuses, then accepts a good one', async () => {
    const { answers, output } = drive<{ description: string }>(
      [
        {
          type: 'input',
          name: 'description',
          message: 'Description:',
          validate: (value: string) => (value.trim() ? true : 'Description cannot be empty'),
        },
      ],
      [ENTER, 'ok', ENTER],
    );

    await expect(answers).resolves.toEqual({ description: 'ok' });
    expect(output()).toContain('Description cannot be empty');
  });
});

describe('inquirer confirm prompt', () => {
  it('defaults to yes', async () => {
    const { answers } = drive<{ confirmed: boolean }>(
      [{ type: 'confirm', name: 'confirmed', message: 'Create commit?', default: true }],
      [ENTER],
    );
    await expect(answers).resolves.toEqual({ confirmed: true });
  });

  it('takes an explicit no', async () => {
    const { answers } = drive<{ confirmed: boolean }>(
      [{ type: 'confirm', name: 'confirmed', message: 'Create commit?', default: true }],
      ['n', ENTER],
    );
    await expect(answers).resolves.toEqual({ confirmed: false });
  });
});

describe('cancellation', () => {
  it('rejects with an error ReviewUI recognises as a cancellation', async () => {
    const { answers } = drive(
      [{ type: 'input', name: 'anything', message: 'Type something:' }],
      // Ctrl-C
      [''],
    );

    // ReviewUI turns this into UserCancelError by matching the error name.
    await expect(answers).rejects.toSatisfy(
      (err: Error) => err.name === 'ExitPromptError' || err.name === 'AbortPromptError',
    );
  });
});
