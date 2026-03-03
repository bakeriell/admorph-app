/**
 * Single source for Gemini API key. Vite injects VITE_* at build time.
 * Order: import.meta.env (Vite standard) then process.env (define fallback).
 */
function getSafeKey(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  let t = key.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    t = t.slice(1, -1).trim();
  if (!t || t === 'undefined' || t === 'null' || t === '""' || t === "''" || t.length < 10)
    return null;
  return t;
}

export function getGeminiApiKey(): string | null {
  const meta = (import.meta as any).env;
  return (
    getSafeKey(meta?.VITE_GEMINI_API_KEY) ??
    getSafeKey(meta?.VITE_Gemini_API_KEY) ??
    getSafeKey((process.env as any).GEMINI_API_KEY) ??
    getSafeKey((process.env as any).Gemini_API_KEY) ??
    getSafeKey((process.env as any).API_KEY) ??
    getSafeKey((process.env as any).GOOGLE_API_KEY) ??
    getSafeKey((typeof window !== 'undefined' && (window as any).process?.env?.API_KEY)) ??
    getSafeKey((typeof window !== 'undefined' && (window as any).process?.env?.GEMINI_API_KEY) ?? null)
  );
}
