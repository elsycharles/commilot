import { resolveFields, type FieldSpec } from '../core/Template.js';
import type { FormatConfig } from '../types/config.js';
import type { ParsedDiff } from '../types/diff.js';
import { statusLetter } from '../types/diff.js';

/** Strategy chosen for a diff based on its size (spec §6.2). */
export type TokenBudgetStrategy = 'full' | 'summarised' | 'stats-only';

/**
 * The shape the answer must take, described without reference to any provider.
 * Backends that can constrain their output translate it into their own format;
 * the others simply ignore it and rely on the prompt.
 */
export interface ExpectedShape {
  kind: 'object' | 'array';
  types: string[];
  /** Every field the answer must carry, including user-defined ones. */
  fields: FieldSpec[];
}

export interface BuiltPrompt {
  system: string;
  user: string;
  strategy: TokenBudgetStrategy;
  expects: ExpectedShape;
}

/** Pick the token budget strategy for a diff of the given size. */
export function selectStrategy(totalLines: number): TokenBudgetStrategy {
  if (totalLines <= 500) return 'full';
  if (totalLines <= 2000) return 'summarised';
  return 'stats-only';
}

const HUNK_PREVIEW_LINES = 10;

function fileHeader(file: ParsedDiff['files'][number]): string {
  const rename = file.oldPath ? ` (renamed from ${file.oldPath})` : '';
  return `${statusLetter(file.status)}  ${file.path}${rename}  (+${file.additions}, -${file.deletions})`;
}

/** Render the diff for the prompt, honouring the token budget strategy. */
export function renderDiff(diff: ParsedDiff, strategy: TokenBudgetStrategy): string {
  if (strategy === 'full') return diff.raw.trim();

  const blocks = diff.files.map((file) => {
    const header = fileHeader(file);
    if (strategy === 'stats-only') return header;
    const hunks = file.hunks
      .map((hunk) => [hunk.header, ...hunk.lines.slice(0, HUNK_PREVIEW_LINES)].join('\n'))
      .join('\n');
    return hunks ? `${header}\n${hunks}` : header;
  });

  return blocks.join('\n\n');
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '(none defined)';
}

function scopeRule(format: FormatConfig): string {
  return format.scopes.length > 0
    ? `- scope MUST be one of: ${formatList(format.scopes)}`
    : '- scope MUST be a short, lowercase feature area inferred from the changed code (e.g. auth, api, config)';
}

/**
 * Which values must be written in the configured language.
 *
 * Free text only: `type` and a value picked from a fixed list are identifiers
 * the user chose, and translating them would break the very constraint they
 * express. `scope` is left alone for the same reason — it names a part of the
 * codebase, not a sentence.
 */
function languageRule(format: FormatConfig, fields: FieldSpec[]): string[] {
  const translatable = fields
    .filter((field) => field.name !== 'type' && field.name !== 'scope' && field.values.length === 0)
    .map((field) => field.name);

  if (translatable.length === 0) return [];
  return [
    `- ${translatable.map((name) => `"${name}"`).join(', ')} MUST be written in this language (ISO 639-1): ${format.language}`,
  ];
}

/** One line per field, so the model knows what each key is for. */
function fieldRules(fields: FieldSpec[]): string[] {
  return fields
    .filter((field) => !field.builtIn)
    .map((field) => {
      const values = field.values.length > 0 ? ` MUST be one of: ${formatList(field.values)}.` : '';
      const max = field.maxLength ? ` Max ${field.maxLength} characters.` : '';
      return `- "${field.name}": ${field.description}.${values}${max}`;
    });
}

/** The exact JSON keys expected back, shown as a skeleton. */
function jsonSkeleton(fields: FieldSpec[], withFiles: boolean): string {
  const entries = fields.map((field) => `"${field.name}": "..."`);
  if (withFiles) entries.push('"files": ["path/to/file"]');
  return `{${entries.join(', ')}}`;
}

const GENERATE_EXAMPLES = `Examples of good output:
{"type": "feat", "scope": "auth", "description": "add jwt token refresh mechanism"}
{"type": "bug", "scope": "api", "description": "handle null response from user endpoint"}
{"type": "dev", "scope": "config", "description": "tighten eslint rules for unused imports"}

Examples of BAD output (never do this):
{"type": "feature", "scope": "Auth", "description": "Added JWT token refresh."}  // invalid type, capitalised scope, past tense, trailing period
Any prose, markdown fences, or explanation outside the JSON object.`;

const SPLIT_EXAMPLES = `Example of good output:
[
  {"type": "feat", "scope": "auth", "description": "add login endpoint with validation", "files": ["src/controllers/auth.controller.ts", "src/dto/login.dto.ts"]},
  {"type": "dev", "scope": "config", "description": "tighten eslint rules", "files": [".eslintrc.json"]}
]

Examples of BAD output (never do this):
Placing the same file in two groups, omitting a file that appears in the diff,
wrapping the JSON in markdown fences, or adding any commentary.`;

/**
 * Builds the provider-agnostic prompts. Only the transport differs per
 * provider; the prompt content is identical across Gemini, OpenAI and Claude.
 */
export class PromptBuilder {
  constructor(private readonly format: FormatConfig) {}

  /** System + user prompt for single-commit generation. */
  buildGeneratePrompt(diff: ParsedDiff): BuiltPrompt {
    const strategy = selectStrategy(diff.totalLines);
    const fields = resolveFields(this.format);
    const system = [
      'You are a commit message generator. Analyse the following git diff and produce',
      `a commit message following this exact format: ${this.format.template}`,
      '',
      'Rules:',
      `- type MUST be one of: ${formatList(this.format.types)}`,
      scopeRule(this.format),
      `- description MUST be lowercase, imperative mood, max ${this.format.descriptionMaxLength} chars`,
      '- description MUST NOT end with a period',
      ...languageRule(this.format, fields),
      '- describe WHAT changed and WHY, never restate the file names',
      ...fieldRules(fields),
      `- Respond ONLY with valid JSON: ${jsonSkeleton(fields, false)}`,
      '',
      GENERATE_EXAMPLES,
      strategy === 'full'
        ? ''
        : '\nNote: the diff below is truncated to fit the context window; infer intent from the file names and the shown lines.',
    ]
      .join('\n')
      .trim();

    return {
      system,
      user: this.buildUserPrompt(diff, strategy),
      strategy,
      expects: { kind: 'object', types: this.format.types, fields },
    };
  }

  /** System + user prompt for split mode. */
  buildSplitPrompt(diff: ParsedDiff, maxCommits: number): BuiltPrompt {
    const strategy = selectStrategy(diff.totalLines);
    const fields = resolveFields(this.format);
    const paths = diff.files.map((file) => file.path);
    const system = [
      'You are a commit splitter. Analyse the following git diff containing changes to',
      'multiple files. Group the changes into logical commits. Each group should represent',
      'a single coherent change.',
      '',
      'Rules:',
      '- Each group MUST list the exact file paths that belong to it, copied verbatim',
      '- Every file in the diff MUST appear in exactly one group',
      '- A file can only appear in ONE group',
      `- type MUST be one of: ${formatList(this.format.types)}`,
      scopeRule(this.format),
      `- description MUST be lowercase, imperative mood, max ${this.format.descriptionMaxLength} chars, no trailing period`,
      ...languageRule(this.format, fields),
      ...fieldRules(fields),
      `- Maximum ${maxCommits} groups`,
      '- Respond ONLY with valid JSON array:',
      `  [${jsonSkeleton(fields, true)}]`,
      '- Order groups by logical dependency (foundational changes first)',
      '',
      SPLIT_EXAMPLES,
      '',
      `The diff contains exactly these ${paths.length} files:`,
      ...paths.map((path) => `- ${path}`),
    ]
      .join('\n')
      .trim();

    return {
      system,
      user: this.buildUserPrompt(diff, strategy),
      strategy,
      expects: { kind: 'array', types: this.format.types, fields },
    };
  }

  private buildUserPrompt(diff: ParsedDiff, strategy: TokenBudgetStrategy): string {
    const header =
      strategy === 'stats-only'
        ? 'Changed files with statistics (diff body omitted — too large):'
        : strategy === 'summarised'
          ? 'Changed files with truncated hunks:'
          : 'Git diff:';
    return `${header}\n\n${renderDiff(diff, strategy)}`;
  }
}
