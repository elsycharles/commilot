import chalk from 'chalk';
import type { CommitGroup } from '../types/commit.js';
import type { FileChange, ParsedDiff } from '../types/diff.js';
import { statusLetter } from '../types/diff.js';

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

/** Printable width of a string, ignoring ANSI colour codes. */
export function visibleWidth(text: string): number {
  return text.replace(ANSI_PATTERN, '').length;
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

export interface BoxOptions {
  title?: string;
  /** Extra left margin, matching the two-space CLI gutter. */
  indent?: string;
  minWidth?: number;
}

/** Render lines inside a rounded box, tolerating embedded ANSI colours. */
export function renderBox(lines: string[], opts: BoxOptions = {}): string {
  const indent = opts.indent ?? '  ';
  const title = opts.title;
  const content = Math.max(
    opts.minWidth ?? 44,
    title ? visibleWidth(title) + 6 : 0,
    ...lines.map(visibleWidth),
  );
  const inner = content + 2;

  const top = title
    ? `┌── ${chalk.bold(title)} ${'─'.repeat(Math.max(0, inner - visibleWidth(title) - 5))}┐`
    : `┌${'─'.repeat(inner)}┐`;
  const bottom = `└${'─'.repeat(inner)}┘`;

  const body = lines.map((line) => `│ ${pad(line, content)} │`);
  return [top, ...body, bottom].map((line) => indent + line).join('\n');
}

function colouredStat(file: FileChange): string {
  const parts: string[] = [];
  if (file.additions > 0) parts.push(chalk.green(`+${file.additions}`));
  if (file.deletions > 0) parts.push(chalk.red(`-${file.deletions}`));
  return parts.length > 0 ? chalk.dim(`(${parts.join(', ')})`) : chalk.dim('(no line changes)');
}

function statusColour(file: FileChange): string {
  const letter = statusLetter(file.status);
  switch (file.status) {
    case 'added':
      return chalk.green(letter);
    case 'deleted':
      return chalk.red(letter);
    case 'renamed':
      return chalk.magenta(letter);
    default:
      return chalk.yellow(letter);
  }
}

/** `M  src/foo.ts   (+12, -3)` lines, aligned on the path column. */
export function renderFileList(files: FileChange[], indent = '  '): string[] {
  const width = Math.max(0, ...files.map((file) => file.path.length));
  return files.map(
    (file) => `${indent}${statusColour(file)}  ${pad(file.path, width)}  ${colouredStat(file)}`,
  );
}

/** File lines for a commit group, resolved against the diff for stats. */
export function renderGroupFiles(group: CommitGroup, diff: ParsedDiff, indent = '  '): string[] {
  const byPath = new Map(diff.files.map((file) => [file.path, file]));
  const files = group.files
    .map((path) => byPath.get(path))
    .filter((file): file is FileChange => Boolean(file));
  if (files.length === 0) return group.files.map((path) => `${indent}${chalk.dim(path)}`);
  return renderFileList(files, indent);
}

/** Colourised commit headline, e.g. `feat(auth) - add login endpoint`. */
export function highlightMessage(message: string): string {
  const match = /^([a-z0-9_-]+)(\([^)]*\))?(.*)$/i.exec(message);
  if (!match) return chalk.bold(message);
  const [, type, scope = '', rest = ''] = match;
  return `${chalk.cyan.bold(type)}${chalk.magenta(scope)}${chalk.bold(rest)}`;
}

/** Short one-line summary of a diff, used in headers. */
export function summariseDiff(diff: ParsedDiff): string {
  const files = diff.files.length;
  return `${files} file${files === 1 ? '' : 's'} changed, ${chalk.green(
    `+${diff.totalAdditions}`,
  )} ${chalk.red(`-${diff.totalDeletions}`)}`;
}
