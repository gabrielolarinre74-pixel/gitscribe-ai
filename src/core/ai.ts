/** AI engine: any OpenAI-compatible chat API (OpenAI, OpenRouter, Groq, Ollama, LM Studio). */
import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import type { Config } from './config.js';
import { trimDiff, type DiffFile } from './diff.js';
import { TYPES, isType, header, type CommitType } from './message.js';
import type { Suggestion } from './offline.js';
import { kindOf, scopeOf } from './classify.js';

const Reply = z.object({
  messages: z.array(z.object({
    type: z.string(),
    scope: z.string().nullish(),
    breaking: z.boolean().nullish(),
    subject: z.string().min(3),
    body: z.string().nullish(),
    breaking_note: z.string().nullish(),
  })).min(1),
});

export interface PromptInput {
  diff: string;
  files: DiffFile[];
  count: number;
  maxLength: number;
  type?: CommitType;
  instructions?: string;
  body: boolean;
}

export function buildPrompt(p: PromptInput): { system: string; user: string } {
  const scope = scopeOf(p.files.filter((f) => kindOf(f.path) !== 'deps').map((f) => f.path));
  const system = [
    'You write git commit messages in the Conventional Commits format.',
    `Allowed types: ${Object.entries(TYPES).map(([t, d]) => `${t} (${d})`).join('; ')}.`,
    `The header "type(scope): subject" must be at most ${p.maxLength} characters.`,
    'Subject: imperative mood, lower case, no trailing full stop, says what changed and why it matters. Never "update code" or "fix bug".',
    'Mark breaking: true only when existing users must change something (removed or renamed public API, changed defaults).',
    p.body ? 'Body: 1 to 4 short "- " bullet lines about the important changes, wrapped at 72 characters.' : 'Do not write a body.',
    p.type ? `Use the type "${p.type}".` : '',
    scope ? `A good scope is likely "${scope}", but omit the scope if the change spans unrelated areas.` : 'Use a short scope only if the change is clearly limited to one area.',
    p.instructions ? `House style from the user: ${p.instructions}` : '',
    `Reply with JSON only: {"messages":[{"type","scope","breaking","subject","body","breaking_note"}]} with exactly ${p.count} distinct option${p.count > 1 ? 's' : ''}, best first.`,
  ].filter(Boolean).join('\n');
  const user = `Staged diff:\n\n${trimDiff(p.diff, 24000)}`;
  return { system, user };
}

export function parseReply(text: string, maxLength: number, forcedType?: CommitType): Suggestion[] {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let data: z.infer<typeof Reply>;
  try { data = Reply.parse(JSON.parse(json)); } catch { throw new Error('The model did not return valid JSON. Try again or switch to the offline engine with --offline.'); }
  const out: Suggestion[] = [];
  for (const m of data.messages) {
    const type = forcedType ?? (isType(m.type.toLowerCase()) ? (m.type.toLowerCase() as CommitType) : 'chore');
    const scope = m.scope?.trim().toLowerCase().replace(/[^a-z0-9._/-]+/g, '-') || undefined;
    let subject = m.subject.trim().replace(/\.$/, '').replace(/^\w+(\([^)]*\))?!?:\s*/, '');
    subject = subject.charAt(0).toLowerCase() + subject.slice(1);
    const breaking = !!m.breaking;
    while (header({ type, scope, breaking, subject }).length > maxLength && subject.includes(' ')) subject = subject.replace(/\s+\S+$/, '');
    const footers = breaking ? [`BREAKING CHANGE: ${m.breaking_note?.trim() || subject}`] : [];
    const s: Suggestion = { type, scope, breaking, subject, body: m.body?.trim() || undefined, footers, reason: 'Written by the AI engine.' };
    if (!out.some((o) => header(o) === header(s))) out.push(s);
  }
  return out;
}

export function assertReady(cfg: Config) {
  const local = /\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(cfg['base-url']);
  if (!cfg['api-key'] && !local) throw new Error('The AI engine needs an API key. Run "gitscribe config set api-key=<key>" or set GITSCRIBE_API_KEY, or use --offline.');
}

export async function suggestWithAI(cfg: Config, input: PromptInput): Promise<Suggestion[]> {
  assertReady(cfg);
  const provider = createOpenAICompatible({ name: 'gitscribe', baseURL: cfg['base-url'], apiKey: cfg['api-key'] || 'local' });
  const { system, user } = buildPrompt(input);
  const { text } = await generateText({ model: provider(cfg.model), system, prompt: user, temperature: 0.4, maxOutputTokens: 1200, abortSignal: AbortSignal.timeout(60_000) });
  return parseReply(text, input.maxLength, input.type).slice(0, input.count);
}
