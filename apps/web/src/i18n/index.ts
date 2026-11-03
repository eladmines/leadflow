import { en } from './en';

/**
 * App language (D-100): English by default, Hebrew as an option. Copy is written in Hebrew in the
 * source and looked up in the English dictionary (keyed by the Hebrew text), so Hebrew needs no
 * dictionary and a missing translation falls back to Hebrew instead of breaking.
 *
 * The language is fixed for a page load: switching saves the choice and reloads, so module-level
 * constants that call `tr()` are always in the right language.
 */

export type Locale = 'en' | 'he';

const STORAGE_KEY = 'leadflow.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'he') return saved;
  } catch {
    // Storage blocked: use the default.
  }
  return 'en';
}

let current: Locale = initialLocale();

export const locale = (): Locale => current;
export const isRtl = (): boolean => current === 'he';
/** For `Intl` formatters (dates, numbers). */
export const intlLocale = (): string => (current === 'he' ? 'he-IL' : 'en-GB');

/** Saves the choice and reloads so every screen and direction switches together. */
export function setLocale(next: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage blocked: the switch lasts for this page only.
  }
  current = next;
  window.location.reload();
}

/** Tests pick the language explicitly (no reload). */
export function setLocaleForTests(next: Locale) {
  current = next;
}

/**
 * Translates Hebrew source copy. `{0}`, `{1}`… are filled from `args` (the source uses the same
 * placeholders), so word order can differ between languages.
 */
export function tr(key: string, ...args: unknown[]): string {
  if (current === 'en' && en[key] === undefined && args.length === 0)
    return fromPattern(key) ?? key;
  const text = current === 'en' ? (en[key] ?? key) : key;
  return args.length ? fill(text, args) : text;
}

const fill = (text: string, args: unknown[]) =>
  text.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));

/**
 * Messages built elsewhere with values already inside (validation limits, names), e.g.
 * "לפחות 10 תווים": matched against the dictionary's `{0}` keys and filled in English.
 */
let patterns: { re: RegExp; english: string }[] | null = null;
function fromPattern(text: string): string | null {
  patterns ??= Object.keys(en)
    .filter((k) => /\{\d+\}/.test(k))
    .map((k) => ({
      re: new RegExp(
        `^${k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d+)\}/g, '(?<p$1>.+?)')}$`,
      ),
      english: en[k]!,
    }));
  for (const { re, english } of patterns) {
    const m = re.exec(text);
    if (m?.groups) {
      return english.replace(/\{(\d+)\}/g, (_, i: string) => m.groups![`p${i}`] ?? '');
    }
  }
  return null;
}

/** Sets `<html lang dir>` for the current language. */
export function applyDocumentLocale() {
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'he' ? 'rtl' : 'ltr';
}
