// Generates the data files the Python site code reads, from the TypeScript originals in
// packages/shared. Run from apps/api:  npx tsx ../api-py/tools/gen_site_data.mjs
//
// The Python port is hand-written for the logic (validation, rendering, template building); only
// large literal data (the fixed site texts, the stylesheet, the template content) is generated.
// After the TypeScript is retired, these files become the source of truth.
import { readFileSync, writeFileSync } from 'node:fs';
import { siteText, buildTemplateDraft, TEMPLATE_KEYS } from '../../../packages/shared/src/index.ts';
import { SITE_SCRIPT } from '../../api/src/modules/embed/site-script.ts';
import { EMBED_SCRIPT } from '../../api/src/modules/embed/script.ts';

const out = new URL('../app/shared/data/', import.meta.url).pathname;
const write = (name, text) => writeFileSync(out + name, text);

// 1. Fixed site texts, per language.
write('site_i18n.json', JSON.stringify({ he: siteText('he'), en: siteText('en') }, null, 1) + '\n');

// 2. The stylesheet: the template literal of `css()` with the palette/font made into tokens.
const src = readFileSync(new URL('../../../packages/shared/src/site-render.ts', import.meta.url), 'utf8');
const start = src.indexOf('function css(');
const open = src.indexOf('return `', start) + 'return `'.length;
const close = src.indexOf('`;\n}', open);
let css = src.slice(open, close);
css = css
  .replaceAll('${palette.primary}', '__PRIMARY__')
  .replaceAll('${palette.accent}', '__ACCENT__')
  .replaceAll('${palette.soft}', '__SOFT__')
  .replaceAll('${family}', '__FAMILY__');
if (css.includes('${')) throw new Error('unhandled expression left in the CSS');
write('site.css', css);

// 3. Template content. The builders depend on the business only through its name, its areas and
// whether it has a phone, so probe with sentinels and record what changes.
const NAME = '§N§';
const AREAS = '§A§';
const probe = (templateKey, lang, { areas, phone }) =>
  JSON.parse(
    JSON.stringify(
      buildTemplateDraft(
        templateKey,
        {
          name: NAME,
          industry: 'other',
          phone: phone ? '+972501234567' : null,
          address: null,
          serviceAreas: areas ? [AREAS] : [],
          openingHours: null,
        },
        lang,
      ),
    ),
  );

/** Leaves where `a` and `b` differ, as [path, aValue, bValue]. */
function diff(a, b, path = []) {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return [[path, a, b]];
  if (a && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diff(a[k], b[k], [...path, k]));
  }
  return a === b ? [] : [[path, a, b]];
}
const setAt = (root, path, value) => {
  let node = root;
  for (const k of path.slice(0, -1)) node = node[k];
  node[path.at(-1)] = value;
};

const templates = {};
for (const lang of ['he', 'en']) {
  for (const key of TEMPLATE_KEYS) {
    const full = probe(key, lang, { areas: true, phone: true });
    const noAreas = probe(key, lang, { areas: false, phone: true });
    const noPhone = probe(key, lang, { areas: true, phone: false });
    for (const [path, withValue, without] of diff(full, noAreas)) {
      setAt(full, path, { $areas: withValue, $noAreas: without });
    }
    for (const [path, withValue, without] of diff(probe(key, lang, { areas: true, phone: true }), noPhone)) {
      setAt(full, path, { $phone: withValue, $noPhone: without });
    }
    templates[`${lang}/${key}`] = full;
  }
}
write('site_templates.json', JSON.stringify(templates, null, 1) + '\n');
// 4. The two page scripts (plain ES5 text).
write('site_script.js', SITE_SCRIPT);
write('embed_script.js', EMBED_SCRIPT);
console.log('wrote site_i18n.json, site.css, site_templates.json, site_script.js, embed_script.js');
