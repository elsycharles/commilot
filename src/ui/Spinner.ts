import ora, { type Ora } from 'ora';
import { logger } from '../utils/logger.js';

/**
 * Thin wrapper over ora that stays silent in non-TTY environments (CI, pipes)
 * and when logging is quiet, so output remains machine-readable.
 */
export class Spinner {
  private instance?: Ora;

  private get enabled(): boolean {
    return process.stdout.isTTY === true && logger.getLevel() !== 'silent';
  }

  start(text: string): this {
    if (!this.enabled) {
      logger.info(`  ${text}`);
      return this;
    }
    this.instance = ora({ text, indent: 2 }).start();
    return this;
  }

  update(text: string): this {
    if (this.instance) this.instance.text = text;
    return this;
  }

  succeed(text?: string): this {
    if (this.instance) this.instance.succeed(text);
    else if (text) logger.info(`  ${text}`);
    this.instance = undefined;
    return this;
  }

  fail(text?: string): this {
    if (this.instance) this.instance.fail(text);
    this.instance = undefined;
    return this;
  }

  stop(): this {
    this.instance?.stop();
    this.instance = undefined;
    return this;
  }
}

/** Run an async task while showing a spinner, stopping it on any outcome. */
export async function withSpinner<T>(
  text: string,
  task: () => Promise<T>,
  successText?: string,
): Promise<T> {
  const spinner = new Spinner().start(text);
  try {
    const result = await task();
    spinner.succeed(successText ?? text);
    return result;
  } catch (err) {
    spinner.fail(text);
    throw err;
  }
}
