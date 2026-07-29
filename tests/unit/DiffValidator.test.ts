import { describe, expect, it } from 'vitest';
import { isExcluded, parseRawDiff, validateDiff } from '../../src/core/DiffValidator.js';
import { behaviourConfigSchema } from '../../src/types/config.js';
import { DiffTooLargeError, NoDiffError } from '../../src/utils/errors.js';
import {
  DELETION_DIFF,
  MULTI_AREA_DIFF,
  NOISY_DIFF,
  RENAME_DIFF,
  SIMPLE_DIFF,
  bigDiff,
} from '../fixtures/diffs.js';

const behaviour = behaviourConfigSchema.parse({});

describe('parseRawDiff', () => {
  it('extracts files, statuses and line counts', () => {
    const diff = parseRawDiff(SIMPLE_DIFF);
    expect(diff.files.map((file) => file.path)).toEqual([
      'src/services/auth.service.ts',
      'src/utils/token-refresh.ts',
    ]);
    expect(diff.files[0]?.status).toBe('modified');
    expect(diff.files[1]?.status).toBe('added');
    expect(diff.totalAdditions).toBeGreaterThan(0);
    expect(diff.totalLines).toBe(diff.totalAdditions + diff.totalDeletions);
  });

  it('recognises renames and deletions', () => {
    const renamed = parseRawDiff(RENAME_DIFF).files[0];
    expect(renamed?.status).toBe('renamed');
    expect(renamed?.path).toBe('src/new-name.ts');
    expect(renamed?.oldPath).toBe('src/old-name.ts');

    const deleted = parseRawDiff(DELETION_DIFF).files[0];
    expect(deleted?.status).toBe('deleted');
    expect(deleted?.path).toBe('src/legacy.ts');
    expect(deleted?.deletions).toBe(2);
  });

  it('keeps hunk content for the prompt', () => {
    const file = parseRawDiff(SIMPLE_DIFF).files[0];
    expect(file?.hunks.length).toBeGreaterThan(0);
    expect(file?.hunks[0]?.lines.some((line) => line.startsWith('+'))).toBe(true);
  });
});

describe('isExcluded', () => {
  it('matches plain names anywhere in the tree', () => {
    expect(isExcluded('package-lock.json', behaviour.excludePatterns)).toBe(true);
    expect(isExcluded('apps/web/package-lock.json', behaviour.excludePatterns)).toBe(true);
  });

  it('matches globs', () => {
    expect(isExcluded('public/app.min.js', behaviour.excludePatterns)).toBe(true);
    expect(isExcluded('src/app.js', behaviour.excludePatterns)).toBe(false);
  });
});

describe('validateDiff', () => {
  it('strips excluded and binary files (AC-11)', () => {
    const result = validateDiff(NOISY_DIFF, behaviour);
    expect(result.diff.files.map((file) => file.path)).toEqual(['src/index.ts']);
    expect(result.excluded).toContain('package-lock.json');
    expect(result.binary).toContain('assets/logo.png');
    expect(result.diff.raw).not.toContain('package-lock.json');
  });

  it('throws NoDiffError on empty input', () => {
    expect(() => validateDiff('', behaviour)).toThrow(NoDiffError);
    expect(() => validateDiff('   \n', behaviour)).toThrow(NoDiffError);
  });

  it('throws NoDiffError when everything was filtered out', () => {
    const onlyLock = NOISY_DIFF.split('diff --git a/src/index.ts')[0] ?? '';
    expect(() => validateDiff(onlyLock, behaviour)).toThrow(NoDiffError);
  });

  it('rejects diffs above maxDiffLines (AC-10)', () => {
    const small = behaviourConfigSchema.parse({ maxDiffLines: 10 });
    expect(() => validateDiff(bigDiff(50), small)).toThrow(DiffTooLargeError);
  });

  it('accepts a diff exactly at the threshold', () => {
    const limit = behaviourConfigSchema.parse({ maxDiffLines: 50 });
    expect(() => validateDiff(bigDiff(50), limit)).not.toThrow();
  });

  it('keeps every file of a multi-area diff', () => {
    const { diff } = validateDiff(MULTI_AREA_DIFF, behaviour);
    expect(diff.files).toHaveLength(3);
  });
});
