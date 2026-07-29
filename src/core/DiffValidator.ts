import { minimatch } from 'minimatch';
import parseDiff from 'parse-diff';
import type { BehaviourConfig } from '../types/config.js';
import type { DiffHunk, FileChange, FileStatusKind, ParsedDiff } from '../types/diff.js';
import { DiffTooLargeError, NoDiffError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

function normalisePath(path: string | undefined): string {
  if (!path) return '';
  // parse-diff keeps the a/ and b/ prefixes git emits.
  return path.replace(/^[ab]\//, '').replace(/^"|"$/g, '');
}

function fileStatus(file: parseDiff.File): FileStatusKind {
  if (file.new) return 'added';
  if (file.deleted) return 'deleted';
  const from = normalisePath(file.from);
  const to = normalisePath(file.to);
  if (from && to && from !== to) return 'renamed';
  if (from || to) return 'modified';
  return 'unknown';
}

function toHunks(file: parseDiff.File): DiffHunk[] {
  return file.chunks.map((chunk) => ({
    header: chunk.content,
    lines: chunk.changes.map((change) => change.content),
  }));
}

/** Convert a raw unified diff into the structured form the pipeline uses. */
export function parseRawDiff(raw: string): ParsedDiff {
  const files: FileChange[] = parseDiff(raw).map((file) => {
    const status = fileStatus(file);
    const to = normalisePath(file.to);
    const from = normalisePath(file.from);
    const path = status === 'deleted' ? from || to : to || from;
    const hunks = toHunks(file);
    const change: FileChange = {
      path,
      status,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      // git renders binary changes without hunks.
      binary: hunks.length === 0 && (file.additions ?? 0) === 0 && (file.deletions ?? 0) === 0,
      hunks,
    };
    if (status === 'renamed' && from) change.oldPath = from;
    return change;
  });

  return summarise(files, raw);
}

function summarise(files: FileChange[], raw: string): ParsedDiff {
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return {
    files,
    totalAdditions,
    totalDeletions,
    totalLines: totalAdditions + totalDeletions,
    raw,
  };
}

/** True when the path matches any of the configured exclude globs. */
export function isExcluded(path: string, patterns: string[]): boolean {
  return patterns.some(
    (pattern) =>
      minimatch(path, pattern, { dot: true }) || minimatch(path, `**/${pattern}`, { dot: true }),
  );
}

export interface ValidationResult {
  diff: ParsedDiff;
  /** Paths dropped because of `behaviour.excludePatterns`. */
  excluded: string[];
  /** Paths dropped because git reported them as binary. */
  binary: string[];
}

/**
 * Strip excluded and binary files, then assert the diff is neither empty nor
 * larger than the configured threshold.
 *
 * @throws {NoDiffError} when nothing analysable remains.
 * @throws {DiffTooLargeError} when the diff exceeds `behaviour.maxDiffLines`.
 */
export function validateDiff(
  raw: string,
  behaviour: BehaviourConfig,
  opts: { emptyMessage?: string } = {},
): ValidationResult {
  if (!raw.trim()) throw new NoDiffError(opts.emptyMessage);

  const parsed = parseRawDiff(raw);
  if (parsed.files.length === 0) throw new NoDiffError(opts.emptyMessage);

  const excluded: string[] = [];
  const binary: string[] = [];
  const kept = parsed.files.filter((file) => {
    if (isExcluded(file.path, behaviour.excludePatterns)) {
      excluded.push(file.path);
      return false;
    }
    if (file.binary) {
      binary.push(file.path);
      return false;
    }
    return true;
  });

  for (const path of excluded) logger.debug(`excluded by pattern: ${path}`);
  for (const path of binary) logger.debug(`excluded (binary): ${path}`);

  if (kept.length === 0) {
    throw new NoDiffError(
      'No analysable changes left after excluding binary files and `behaviour.excludePatterns`.',
    );
  }

  const diff = summarise(kept, rebuildRaw(raw, kept));
  if (diff.totalLines > behaviour.maxDiffLines) {
    throw new DiffTooLargeError(diff.totalLines, behaviour.maxDiffLines);
  }

  return { diff, excluded, binary };
}

/**
 * Rebuild a unified diff containing only the kept files, so the raw text sent
 * to the AI never includes excluded content.
 */
function rebuildRaw(raw: string, kept: FileChange[]): string {
  const keptPaths = new Set(kept.map((file) => file.path));
  const sections = raw.split(/^(?=diff --git )/m).filter(Boolean);
  if (sections.length <= 1) return raw;
  return sections
    .filter((section) => {
      const match = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(section);
      if (!match) return true;
      return keptPaths.has(match[2] ?? '') || keptPaths.has(match[1] ?? '');
    })
    .join('');
}
