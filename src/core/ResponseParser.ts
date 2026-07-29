import {
  commitGroupResponseSchema,
  commitPlanResponseSchema,
  type CommitGroup,
  type CommitPlan,
} from '../types/commit.js';
import { formatConfigSchema, type FormatConfig } from '../types/config.js';
import type { ParsedDiff } from '../types/diff.js';
import { MalformedResponseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Strip markdown fences and any prose surrounding the JSON payload. */
export function stripFences(raw: string): string {
  let text = raw.trim();
  const fence = /^```[a-z]*\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence?.[1]) text = fence[1].trim();
  // Some models prepend a sentence; fall back to the outermost JSON literal.
  if (!text.startsWith('{') && !text.startsWith('[')) {
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
  }
  return text.trim();
}

function parseJson(raw: string): unknown {
  const text = stripFences(raw);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new MalformedResponseError(
      `could not parse JSON (${(err as Error).message}); raw response: ${raw.slice(0, 500)}`,
    );
  }
}

function normaliseWord(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Map an out-of-vocabulary type onto the closest allowed one, e.g. the model
 * answering `feature` when the config only allows `feat`.
 */
export function closestMatch(value: string, allowed: string[]): string | undefined {
  const needle = normaliseWord(value);
  if (!needle) return undefined;

  const exact = allowed.find((item) => normaliseWord(item) === needle);
  if (exact) return exact;

  const prefix = allowed.find(
    (item) => normaliseWord(item).startsWith(needle) || needle.startsWith(normaliseWord(item)),
  );
  if (prefix) return prefix;

  let best: { item: string; distance: number } | undefined;
  for (const item of allowed) {
    const distance = levenshtein(needle, normaliseWord(item));
    if (!best || distance < best.distance) best = { item, distance };
  }
  // Only accept genuinely close matches; anything else is a real mismatch.
  return best && best.distance <= Math.max(2, Math.floor(needle.length / 3))
    ? best.item
    : undefined;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i += 1) {
    const curr = [i, ...new Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[cols - 1] ?? 0;
}

/** Trim a description to the configured budget at the last word boundary. */
export function truncateDescription(description: string, maxLength: number): string {
  const clean = description.trim().replace(/\.+$/, '');
  if (clean.length <= maxLength) return clean;
  const slice = clean.slice(0, maxLength);
  const boundary = slice.lastIndexOf(' ');
  const truncated = (boundary > maxLength * 0.5 ? slice.slice(0, boundary) : slice).trim();
  logger.warn(`Description exceeded ${maxLength} chars and was truncated.`);
  return truncated.replace(/[.,;:]$/, '');
}

function normaliseType(type: string, format: FormatConfig): string {
  const match = closestMatch(type, format.types);
  if (match) {
    if (match !== type.trim()) logger.debug(`mapped type '${type}' → '${match}'`);
    return match;
  }
  logger.warn(
    `AI returned type '${type}' which is not in ${JSON.stringify(format.types)}; using '${format.types[0]}'.`,
  );
  return format.types[0] as string;
}

function normaliseScope(scope: string, format: FormatConfig): string {
  const clean = scope.trim().toLowerCase();
  if (format.scopes.length === 0) return clean;
  const match = closestMatch(clean, format.scopes);
  if (match) return match;
  logger.warn(`Scope '${clean}' is not in the configured scopes; keeping it anyway.`);
  return clean;
}

function normaliseFilePaths(files: string[] | undefined, diff?: ParsedDiff): string[] {
  if (!files) return [];
  if (!diff) return files.map((file) => file.trim());
  const known = new Set(diff.files.map((file) => file.path));
  return files
    .map((file) =>
      file
        .trim()
        .replace(/^\.\//, '')
        .replace(/^[ab]\//, ''),
    )
    .map((file) => {
      if (known.has(file)) return file;
      // Models sometimes answer with a basename or a partial path.
      const suffixMatch = diff.files.find(
        (candidate) => candidate.path.endsWith(`/${file}`) || candidate.path === file,
      );
      return suffixMatch?.path ?? file;
    })
    .filter((file, index, all) => all.indexOf(file) === index);
}

/** Parse and repair a generate-mode response. */
export function parseCommitGroup(
  raw: string,
  format: FormatConfig = formatConfigSchema.parse({}),
  diff?: ParsedDiff,
): CommitGroup {
  const payload = parseJson(raw);
  const candidate = Array.isArray(payload) ? payload[0] : payload;
  const result = commitGroupResponseSchema.safeParse(candidate);
  if (!result.success) {
    throw new MalformedResponseError(
      `response did not match the expected shape: ${result.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    );
  }

  return {
    type: normaliseType(result.data.type, format),
    scope: normaliseScope(result.data.scope ?? '', format),
    description: truncateDescription(result.data.description, format.descriptionMaxLength),
    files: normaliseFilePaths(result.data.files, diff),
  };
}

/**
 * Parse and repair a split-mode response: every file in the diff must end up
 * in exactly one group, empty groups are dropped and duplicates keep their
 * first assignment (spec §5.5).
 */
export function parseCommitPlan(
  raw: string,
  format: FormatConfig = formatConfigSchema.parse({}),
  diff?: ParsedDiff,
  maxCommits = 10,
): CommitPlan {
  const payload = parseJson(raw);
  const asArray = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.commits)
      ? payload.commits
      : [payload];

  const result = commitPlanResponseSchema.safeParse(asArray);
  if (!result.success) {
    throw new MalformedResponseError(
      `split response did not match the expected shape: ${result.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    );
  }

  const seen = new Set<string>();
  const known = diff ? new Set(diff.files.map((file) => file.path)) : undefined;

  const groups: CommitPlan = [];
  for (const entry of result.data) {
    const files = normaliseFilePaths(entry.files, diff).filter((file) => {
      if (seen.has(file)) {
        logger.debug(`file '${file}' appeared twice; keeping first assignment`);
        return false;
      }
      if (known && !known.has(file)) {
        logger.debug(`file '${file}' is not part of the diff; dropping`);
        return false;
      }
      seen.add(file);
      return true;
    });

    if (files.length === 0) {
      logger.debug(`dropping empty group '${entry.description}'`);
      continue;
    }

    groups.push({
      type: normaliseType(entry.type, format),
      scope: normaliseScope(entry.scope ?? '', format),
      description: truncateDescription(entry.description, format.descriptionMaxLength),
      files,
    });
  }

  if (diff) {
    const missing = diff.files.map((file) => file.path).filter((path) => !seen.has(path));
    if (missing.length > 0) {
      logger.warn(
        `${missing.length} file(s) were not assigned by the AI; grouped into a fallback commit.`,
      );
      groups.push({
        type: format.types[0] as string,
        scope: 'misc',
        description: truncateDescription(
          'group remaining unassigned changes',
          format.descriptionMaxLength,
        ),
        files: missing,
      });
    }
  }

  if (groups.length === 0) throw new MalformedResponseError('split response contained no groups');

  if (groups.length > maxCommits) {
    logger.warn(`AI proposed ${groups.length} commits; merging the tail into ${maxCommits}.`);
    return mergeTail(groups, maxCommits, format);
  }

  return groups;
}

/** Fold everything past `maxCommits` into the last kept group. */
function mergeTail(groups: CommitPlan, maxCommits: number, format: FormatConfig): CommitPlan {
  const kept = groups.slice(0, maxCommits);
  const overflow = groups.slice(maxCommits);
  const last = kept[maxCommits - 1];
  if (!last) return kept;
  kept[maxCommits - 1] = {
    ...last,
    scope: 'misc',
    description: truncateDescription(
      `${last.description} and related changes`,
      format.descriptionMaxLength,
    ),
    files: [...last.files, ...overflow.flatMap((group) => group.files)],
  };
  return kept;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Render a CommitGroup through the configured template. */
export function formatCommitMessage(group: CommitGroup, format: FormatConfig): string {
  const message = format.template
    .replace(/\{type\}/g, group.type)
    .replace(/\{scope\}/g, group.scope)
    .replace(/\{description\}/g, group.description);
  // Drop an empty "()" when no scope could be determined.
  return message
    .replace(/\(\s*\)/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
