import { describe, expect, it } from 'vitest';
import { formatCommitMessage } from '../../src/core/ResponseParser.js';
import { customFields, resolveFields, templatePlaceholders } from '../../src/core/Template.js';
import { formatConfigSchema } from '../../src/types/config.js';

const fmt = (over: Record<string, unknown>) => formatConfigSchema.parse(over);

const group = {
  type: 'feat',
  scope: 'auth',
  description: 'add login',
  files: [],
  fields: {} as Record<string, string>,
};

describe('templatePlaceholders', () => {
  it('finds every placeholder once, in order', () => {
    expect(templatePlaceholders('{a} {b} {a} plain {c-d}')).toEqual(['a', 'b', 'c-d']);
  });

  it('ignores braces that are not placeholders', () => {
    expect(templatePlaceholders('{} {1bad} {ok} literal')).toEqual(['ok']);
  });
});

describe('resolveFields', () => {
  it('always asks for the three built-ins, even when unused by the template', () => {
    // Merging commits and the fallback group read them, so a response without
    // them would break more than the rendered message.
    const fields = resolveFields(fmt({ template: '{title}' }));
    expect(fields.map((f) => f.name)).toEqual(['type', 'scope', 'description', 'title']);
  });

  it('describes a custom field from the configuration', () => {
    const fields = resolveFields(
      fmt({
        template: '{ticket}',
        fields: { ticket: { description: 'the issue number', values: ['A', 'B'] } },
      }),
    );
    const ticket = fields.find((f) => f.name === 'ticket');
    expect(ticket).toMatchObject({ description: 'the issue number', values: ['A', 'B'] });
  });

  it('falls back to a readable hint when a field is undeclared', () => {
    const [field] = customFields(fmt({ template: '{releaseTitle}' }));
    expect(field?.description).toContain('release title');
  });
});

describe('formatCommitMessage with custom fields', () => {
  it('fills a template made only of custom placeholders', () => {
    const format = fmt({
      template: '{desc2} ({title}) : {type} {desc3} | {genre}',
      fields: { title: {}, desc2: {}, desc3: {}, genre: {} },
    });
    const message = formatCommitMessage(
      {
        ...group,
        fields: {
          title: 'Login Endpoint',
          desc2: 'add login call',
          desc3: 'to authenticate users',
          genre: 'developer',
        },
      },
      format,
    );

    expect(message).toBe(
      'add login call (Login Endpoint) : feat to authenticate users | developer',
    );
  });

  it('repeats a placeholder as many times as it appears', () => {
    const format = fmt({ template: '{title} — {type} — {title}', fields: { title: {} } });
    expect(formatCommitMessage({ ...group, fields: { title: 'X' } }, format)).toBe('X — feat — X');
  });

  it('tidies up brackets left empty by a missing value', () => {
    const format = fmt({
      template: '{type}({scope}) [{ticket}] {description}',
      fields: { ticket: {} },
    });
    const message = formatCommitMessage({ ...group, fields: { ticket: '' } }, format);
    expect(message).toBe('feat(auth) add login');
  });

  it('still renders the built-in template unchanged', () => {
    expect(formatCommitMessage(group, fmt({}))).toBe('feat(auth) - add login');
  });
});
