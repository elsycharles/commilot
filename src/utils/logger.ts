import chalk from 'chalk';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

class Logger {
  private level: LogLevel = 'info';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  setVerbose(verbose: boolean): void {
    this.level = verbose ? 'debug' : 'info';
  }

  get verbose(): boolean {
    return LEVEL_ORDER[this.level] >= LEVEL_ORDER.debug;
  }

  private enabled(level: Exclude<LogLevel, 'silent'>): boolean {
    return LEVEL_ORDER[this.level] >= LEVEL_ORDER[level];
  }

  error(message: string): void {
    if (this.enabled('error')) console.error(`${chalk.red('✖')} ${message}`);
  }

  warn(message: string): void {
    if (this.enabled('warn')) console.error(`${chalk.yellow('!')} ${message}`);
  }

  info(message: string): void {
    if (this.enabled('info')) console.log(message);
  }

  success(message: string): void {
    if (this.enabled('info')) console.log(`${chalk.green('✔')} ${message}`);
  }

  debug(message: string): void {
    if (this.enabled('debug')) console.error(chalk.dim(`[debug] ${message}`));
  }

  /** Blank line, respecting the info level. */
  blank(): void {
    if (this.enabled('info')) console.log('');
  }
}

export const logger = new Logger();
