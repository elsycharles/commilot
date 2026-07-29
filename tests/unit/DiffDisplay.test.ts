import chalk from 'chalk';
import { describe, expect, it } from 'vitest';
import { parseRawDiff } from '../../src/core/DiffValidator.js';
import {
  highlightMessage,
  renderBox,
  renderFileList,
  renderGroupFiles,
  summariseDiff,
  visibleWidth,
} from '../../src/ui/DiffDisplay.js';
import { MULTI_AREA_DIFF } from '../fixtures/diffs.js';

const diff = parseRawDiff(MULTI_AREA_DIFF);

/** Widths of every rendered line, ignoring the indent and ANSI colours. */
function lineWidths(box: string): number[] {
  return box.split('\n').map((line) => visibleWidth(line.trimStart()));
}

describe('visibleWidth', () => {
  it('ignores ANSI colour codes', () => {
    expect(visibleWidth(chalk.red('abc'))).toBe(3);
    expect(visibleWidth('abc')).toBe(3);
  });
});

describe('renderBox', () => {
  it('keeps every border aligned without a title', () => {
    const widths = lineWidths(renderBox(['one', 'two']));
    expect(new Set(widths).size).toBe(1);
  });

  it('keeps every border aligned with a title', () => {
    const widths = lineWidths(renderBox(['one', 'two'], { title: 'Commit Plan (1 commit)' }));
    expect(new Set(widths).size).toBe(1);
  });

  it('stays aligned for titles of any length', () => {
    for (const title of ['A', 'Proposed Commit', 'Commit Plan (10 commits)', 'x'.repeat(60)]) {
      const widths = lineWidths(renderBox(['short', 'a much longer line here'], { title }));
      expect(new Set(widths).size, `title: ${title}`).toBe(1);
    }
  });

  it('stays aligned when the content is coloured', () => {
    const widths = lineWidths(
      renderBox([chalk.green('+42'), chalk.red('-7')], { title: chalk.bold('Diff') }),
    );
    expect(new Set(widths).size).toBe(1);
  });

  it('grows to fit the longest line', () => {
    const long = 'x'.repeat(80);
    const widths = lineWidths(renderBox([long]));
    expect(widths[0]).toBeGreaterThanOrEqual(long.length + 4);
  });
});

describe('file rendering', () => {
  it('marks status and stats per file', () => {
    const lines = renderFileList(diff.files, '');
    expect(lines[0]).toContain('src/controllers/auth.controller.ts');
    expect(lines.join('\n')).toContain('+2');
  });

  it('resolves the files of a group against the diff', () => {
    const lines = renderGroupFiles(
      { type: 'dev', scope: 'config', description: 'x', files: ['.eslintrc.json'] },
      diff,
      '',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('.eslintrc.json');
  });

  it('falls back to plain paths for files missing from the diff', () => {
    const lines = renderGroupFiles(
      { type: 'dev', scope: 'x', description: 'x', files: ['ghost.ts'] },
      diff,
      '',
    );
    expect(lines[0]).toContain('ghost.ts');
  });

  it('summarises a diff in one line', () => {
    expect(summariseDiff(diff)).toContain('3 files changed');
  });

  it('highlights the type and scope of a message', () => {
    expect(visibleWidth(highlightMessage('feat(auth) - add login'))).toBe(
      'feat(auth) - add login'.length,
    );
  });
});
