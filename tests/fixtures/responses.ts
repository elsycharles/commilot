/** Canned provider responses used by the unit and E2E tests. */

export const GENERATE_JSON = JSON.stringify({
  type: 'feat',
  scope: 'auth',
  description: 'add jwt token refresh mechanism',
});

export const GENERATE_JSON_FENCED = `Here you go:\n\`\`\`json\n${GENERATE_JSON}\n\`\`\``;

export const SPLIT_JSON = JSON.stringify([
  {
    type: 'feat',
    scope: 'auth',
    description: 'add login endpoint with validation',
    files: ['src/controllers/auth.controller.ts'],
  },
  {
    type: 'feat',
    scope: 'dashboard',
    description: 'add user stats widget',
    files: ['src/components/stats-widget.tsx'],
  },
  {
    type: 'dev',
    scope: 'config',
    description: 'update eslint rules for stricter checks',
    files: ['.eslintrc.json'],
  },
]);

/** Wraps a text payload in the Gemini `generateContent` envelope. */
export function geminiEnvelope(text: string): unknown {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
  };
}

/** Wraps a text payload in the OpenAI chat-completions envelope. */
export function openAiEnvelope(text: string): unknown {
  return { choices: [{ message: { content: text } }] };
}

/** Wraps a text payload in the Anthropic messages envelope. */
export function claudeEnvelope(text: string): unknown {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
}
