// Positional token hash shared by the native FeatureScript tokenizer spike
// (kernel/lang/spike/tokenize.bend `summary_of`) and src/parser.mjs tokens:
// kind (name 1, number 2, symbol 3, string 4), line and column of every token
// in order, plus per-kind counts and the total token text length in code
// points. Equal summaries mean the two tokenizers agree token for token on
// kind and position (and on text length).
const KIND = { name: 1, number: 2, symbol: 3, string: 4 };
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

export function tokenSummary(source, tokens) {
  const lineStart = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStart.push(i + 1);
  const mix = (a, b) => (Math.imul(a, 16777619) + b) >>> 0;
  const s = { tokens: 0, name: 0, number: 0, symbol: 0, string: 0, hash: 2166136261, textChars: 0 };
  for (const t of tokens) {
    if (t.kind === 'eof') continue;
    s.tokens++; s[t.kind]++;
    s.hash = mix(mix(mix(s.hash, KIND[t.kind]), t.line), t.column);
    // Number tokens carry their value, not their spelling: re-read the spelling.
    const text = t.kind === 'number' ? source.slice(lineStart[t.line - 1] + t.column - 1).match(NUMBER)[0] : String(t.value);
    s.textChars = (s.textChars + [...text].length) >>> 0;
  }
  return s;
}
