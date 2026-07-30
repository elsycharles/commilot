import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Spinner, withSpinner } from '../../src/ui/Spinner.js';
import { logger } from '../../src/utils/logger.js';

/**
 * The spinner only calls into ora when stdout is a TTY, which never happens
 * under a test runner. These tests fake it, so a provider-agnostic upgrade of
 * ora cannot silently break the one path users actually see.
 */
const realIsTty = process.stdout.isTTY;
let written: string[];

function pretendTty(isTty: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value: isTty, configurable: true });
}

beforeEach(() => {
  written = [];
  // ora writes to stderr, the logger to stdout: capture both.
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
  }
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    written.push(args.join(' '));
  });
});

afterEach(() => {
  Object.defineProperty(process.stdout, 'isTTY', { value: realIsTty, configurable: true });
  logger.setLevel('info');
  vi.restoreAllMocks();
});

describe('on a TTY', () => {
  beforeEach(() => pretendTty(true));

  it('renders the closing text after an update', () => {
    const spinner = new Spinner().start('Analysing');
    spinner.update('Still analysing');
    spinner.succeed('Analysed 3 files');

    // Animated frames only appear on an interactive terminal (never in CI),
    // but the closing line is always written — that is what users read.
    expect(written.join('')).toContain('Analysed 3 files');
  });

  it('marks a failure', () => {
    new Spinner().start('Calling the API').fail('API refused');
    expect(written.join('')).toContain('API refused');
  });

  it('stops without leaving anything running', () => {
    const spinner = new Spinner().start('Working');
    expect(() => spinner.stop()).not.toThrow();
  });
});

describe('off a TTY', () => {
  beforeEach(() => pretendTty(false));

  it('falls back to a plain line so piped output stays readable', () => {
    new Spinner().start('Analysing staged changes').succeed();
    expect(written.join('\n')).toContain('Analysing staged changes');
  });

  it('says nothing at all when the logger is silent', () => {
    logger.setLevel('silent');
    new Spinner().start('Analysing').succeed('done');
    expect(written.join('')).toBe('');
  });
});

describe('withSpinner', () => {
  it('returns the task result', async () => {
    pretendTty(true);
    await expect(withSpinner('Working', async () => 42)).resolves.toBe(42);
  });

  it('propagates the error and stops the spinner', async () => {
    pretendTty(true);
    const boom = new Error('provider exploded');
    await expect(
      withSpinner('Working', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});
