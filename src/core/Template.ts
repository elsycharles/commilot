import type { CustomField, FormatConfig } from '../types/config.js';

/** Placeholders Commilot fills in itself, with their own validation rules. */
export const BUILT_IN_FIELDS = ['type', 'scope', 'description'] as const;
export type BuiltInField = (typeof BUILT_IN_FIELDS)[number];

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g;

export function isBuiltIn(name: string): name is BuiltInField {
  return (BUILT_IN_FIELDS as readonly string[]).includes(name);
}

/** Every `{placeholder}` in the template, in order, without duplicates. */
export function templatePlaceholders(template: string): string[] {
  const found = [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
  return [...new Set(found)];
}

/** One field the model has to produce, described so it knows what to write. */
export interface FieldSpec {
  name: string;
  builtIn: boolean;
  description: string;
  /** Allowed answers, if the user restricted them. */
  values: string[];
  maxLength?: number;
}

/**
 * Everything the template asks for, resolved against the configuration.
 *
 * A placeholder with no `format.fields` entry is still requested — the field
 * name is then the only hint the model gets, which is worse than a sentence
 * but better than dropping the field and rendering `{title}` literally.
 */
export function resolveFields(format: FormatConfig): FieldSpec[] {
  const declared: Record<string, CustomField> = format.fields ?? {};

  // The three built-ins are always requested, even when the template does not
  // render them: merging commits, the fallback group and the logs all read
  // them, so a response without them would break more than the message.
  const specs: FieldSpec[] = BUILT_IN_FIELDS.map((name) => builtInSpec(name, format));

  for (const name of templatePlaceholders(format.template)) {
    if (isBuiltIn(name)) continue;
    const custom = declared[name];
    specs.push({
      name,
      builtIn: false,
      description: custom?.description?.trim() || `the ${humanise(name)} of this change`,
      values: custom?.values ?? [],
      ...(custom?.maxLength !== undefined ? { maxLength: custom.maxLength } : {}),
    });
  }

  return specs;
}

/** Custom fields only — the ones the parser has to read out of the response. */
export function customFields(format: FormatConfig): FieldSpec[] {
  return resolveFields(format).filter((field) => !field.builtIn);
}

function builtInSpec(name: BuiltInField, format: FormatConfig): FieldSpec {
  switch (name) {
    case 'type':
      return {
        name,
        builtIn: true,
        description: 'the kind of change',
        values: format.types,
      };
    case 'scope':
      return {
        name,
        builtIn: true,
        description:
          format.scopes.length > 0
            ? 'the feature area, taken from the allowed list'
            : 'a short, lowercase feature area inferred from the changed code',
        values: format.scopes,
      };
    case 'description':
      return {
        name,
        builtIn: true,
        description: 'what changed and why, lowercase, imperative mood, no trailing period',
        values: [],
        maxLength: format.descriptionMaxLength,
      };
  }
}

/** `releaseTitle` → `release title`, so an undescribed field still reads well. */
function humanise(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}
