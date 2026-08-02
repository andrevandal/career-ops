// tests/theme-style.test.mjs — unit coverage for the dynamic PDF theming helper
// (#1837): token parsing, style-block building/sanitizing, HTML injection, and a
// guard that the shipped templates actually read the variables with defaults.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

console.log('\ntheme-style.mjs (dynamic PDF theming, #1837)');

try {
  const {
    styleTokensFrom, readStyleTokens, buildThemeStyleBlock, injectThemeStyle,
  } = await import(pathToFileURL(join(ROOT, 'theme-style.mjs')).href);

  // styleTokensFrom: recognized keys → css vars; ignore unknown/non-string/missing
  const t = styleTokensFrom({ accent_color: '#2563eb', font_family: 'Outfit, sans-serif', font_size: '10pt', margin: '0.5in', nope: 'x', font_weight: 700 });
  if (t['--accent-color'] === '#2563eb' && t['--font-family'] === 'Outfit, sans-serif' && t['--font-size'] === '10pt' && t['--page-margin'] === '0.5in'
      && !('--font-weight' in t) && Object.keys(t).length === 4) {
    pass('styleTokensFrom maps the 4 recognized keys and ignores unknown/non-string');
  } else {
    fail(`styleTokensFrom => ${JSON.stringify(t)}`);
  }
  if (Object.keys(styleTokensFrom(null)).length === 0 && Object.keys(styleTokensFrom('x')).length === 0 && Object.keys(styleTokensFrom([])).length === 0) {
    pass('styleTokensFrom returns {} for null/non-object/array');
  } else {
    fail('styleTokensFrom should return {} for null/non-object/array');
  }

  // styleTokensFrom: the new heading-level + normal-text keys map correctly too
  const t2 = styleTokensFrom({
    heading1_size: '30px', heading1_weight: '800',
    heading2_size: '13px', heading2_weight: '700', heading2_letter_spacing: '0.08em',
    heading3_size: '13px', heading3_weight: '600',
    body_line_height: '1.6', body_color: '#222',
    heading_font_family: "'Varela Round', sans-serif",
    ink_color: '#040B0E', accent_tint_bg: '#CCECE5', accent_tint_border: '#99D9CC', muted_color: '#747673',
  });
  const expectedHeadingVars = {
    '--heading1-size': '30px', '--heading1-weight': '800',
    '--heading2-size': '13px', '--heading2-weight': '700', '--heading2-letter-spacing': '0.08em',
    '--heading3-size': '13px', '--heading3-weight': '600',
    '--body-line-height': '1.6', '--body-color': '#222',
    '--heading-font-family': "'Varela Round', sans-serif",
    '--ink-color': '#040B0E', '--accent-tint-bg': '#CCECE5', '--accent-tint-border': '#99D9CC', '--muted-color': '#747673',
  };
  const headingVarsMatch = Object.entries(expectedHeadingVars).every(([k, v]) => t2[k] === v)
    && Object.keys(t2).length === Object.keys(expectedHeadingVars).length;
  if (headingVarsMatch) pass('styleTokensFrom maps the 14 heading-level/normal-text/heading-font/design-token keys');
  else fail(`styleTokensFrom heading vars => ${JSON.stringify(t2)}`);

  // readStyleTokens: from a profile file; missing file → {}
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-theme-'));
  try {
    const p = join(dir, 'profile.yml');
    writeFileSync(p, 'candidate:\n  full_name: X\nstyle:\n  accent_color: "#ff0000"\n');
    const rt = readStyleTokens(p);
    if (rt['--accent-color'] === '#ff0000' && Object.keys(rt).length === 1) pass('readStyleTokens reads the style block from a profile file');
    else fail(`readStyleTokens => ${JSON.stringify(rt)}`);
    if (Object.keys(readStyleTokens(join(dir, 'nope.yml'))).length === 0) pass('readStyleTokens returns {} for a missing profile');
    else fail('readStyleTokens should return {} for a missing profile');
    // profile without a style block
    const p2 = join(dir, 'nostyle.yml'); writeFileSync(p2, 'candidate:\n  full_name: X\n');
    if (Object.keys(readStyleTokens(p2)).length === 0) pass('readStyleTokens returns {} when there is no style block');
    else fail('readStyleTokens should return {} without a style block');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // buildThemeStyleBlock: empty → ''; builds :root; sanitizes control chars
  if (buildThemeStyleBlock({}) === '' && buildThemeStyleBlock(null) === '') pass('buildThemeStyleBlock returns "" for no tokens');
  else fail('buildThemeStyleBlock should return "" for no tokens');
  const block = buildThemeStyleBlock({ '--accent-color': '#2563eb', '--font-size': '10pt' });
  if (block.includes('id="career-ops-dynamic-theme"') && block.includes(':root {') && block.includes('--accent-color: #2563eb;') && block.includes('--font-size: 10pt;')) {
    pass('buildThemeStyleBlock emits a :root block with the declarations');
  } else {
    fail(`buildThemeStyleBlock => ${block}`);
  }
  // a value trying to break out of the rule / tag is dropped
  const evil = buildThemeStyleBlock({ '--accent-color': 'red; } body{display:none} <script>', '--font-size': '10pt' });
  if (!evil.includes('<script>') && !evil.includes('display:none') && evil.includes('--font-size: 10pt;') && !evil.includes('--accent-color')) {
    pass('buildThemeStyleBlock drops values containing CSS/HTML control chars (injection-safe)');
  } else {
    fail(`buildThemeStyleBlock injection => ${evil}`);
  }

  // injectThemeStyle: no-op without tokens; inserts before </head>; prepends when no head
  const html = '<html><head><style>body{}</style></head><body>x</body></html>';
  if (injectThemeStyle(html, {}) === html) pass('injectThemeStyle is a no-op with no tokens (byte-identical)');
  else fail('injectThemeStyle should be a no-op with no tokens');
  const injected = injectThemeStyle(html, { '--accent-color': '#2563eb' });
  if (injected.includes('career-ops-dynamic-theme') && injected.indexOf('career-ops-dynamic-theme') < injected.indexOf('</head>') && injected.indexOf('career-ops-dynamic-theme') > injected.indexOf('<style>')) {
    pass('injectThemeStyle inserts the theme block before </head>, after the template style');
  } else {
    fail(`injectThemeStyle head => ${injected}`);
  }
  const noHead = injectThemeStyle('<div>x</div>', { '--accent-color': '#2563eb' });
  if (noHead.startsWith('<style id="career-ops-dynamic-theme"')) pass('injectThemeStyle prepends the block when there is no </head>');
  else fail(`injectThemeStyle no-head => ${noHead}`);

  // Template guard: shipped templates read the vars with :root defaults, no circular refs
  for (const tpl of ['templates/cv-template.html', 'templates/cover-letter-template.html']) {
    const src = readFileSync(join(ROOT, tpl), 'utf-8');
    const hasRoot = /:root\s*\{[^}]*--accent-color:[^}]*--font-family:[^}]*--font-size:[^}]*--page-margin:/s.test(src);
    const usesVars = src.includes('var(--accent-color)') && src.includes('var(--font-family)') && src.includes('var(--font-size)') && src.includes('var(--page-margin)');
    const circular = /--(accent-color|font-family|font-size|page-margin):\s*var\(/.test(src);
    if (hasRoot && usesVars && !circular) pass(`${tpl} declares :root theme defaults and reads them via var() (no circular refs)`);
    else fail(`${tpl}: hasRoot=${hasRoot} usesVars=${usesVars} circular=${circular}`);
  }

  // Template guard: cv-template.html's new heading-level/normal-text tokens (the
  // style brainstorm follow-up) also declare :root defaults and are read via
  // var(), with no circular refs — same contract as the original 4 tokens above,
  // scoped to cv-template.html only (cover-letter-template.html doesn't carry
  // resume-specific heading levels).
  {
    const src = readFileSync(join(ROOT, 'templates/cv-template.html'), 'utf-8');
    const headingVars = ['heading1-size', 'heading1-weight', 'heading2-size', 'heading2-weight',
      'heading2-letter-spacing', 'heading3-size', 'heading3-weight', 'body-line-height', 'body-color'];
    const hasRoot = headingVars.every((v) => new RegExp(`--${v}:`).test(src));
    const usesVars = headingVars.every((v) => src.includes(`var(--${v})`));
    const circular = headingVars.some((v) => new RegExp(`--${v}:\\s*var\\(`).test(src));
    if (hasRoot && usesVars && !circular) {
      pass('cv-template.html declares :root defaults for the heading/body tokens and reads them via var() (no circular refs)');
    } else {
      fail(`cv-template.html heading vars: hasRoot=${hasRoot} usesVars=${usesVars} circular=${circular}`);
    }
  }

  // Template guard: the design-token color layer (#personalization) — ink-color
  // and the two accent-tint vars have canonical :root defaults (byte-identical
  // by default); muted-color has NO canonical default, only per-occurrence
  // var(--muted-color, <original literal>) fallbacks, so a profile without
  // style.muted_color renders every consumer's original distinct gray exactly
  // as before. Applies to cv-template.html only (cover-letter-template.html
  // doesn't carry these resume-specific consumers).
  {
    const src = readFileSync(join(ROOT, 'templates/cv-template.html'), 'utf-8');
    const hasCanonicalRoot = /--ink-color:\s*#1a1a2e;/.test(src)
      && /--accent-tint-bg:\s*hsl\(187, 40%, 95%\);/.test(src)
      && /--accent-tint-border:\s*hsl\(187, 40%, 88%\);/.test(src);
    const inkUsedByHeader = /\.header h1\s*\{[^}]*color:\s*var\(--ink-color\)/s.test(src);
    const inkUsedByBody = /\bbody\s*\{[^}]*color:\s*var\(--ink-color\)/s.test(src);
    const outlinedTag = /\.competency-tag\s*\{[^}]*color:\s*var\(--accent-color\);\s*background:\s*transparent;[^}]*border:\s*1px solid var\(--accent-color\);/s.test(src);
    const noProjectBadgeClass = !/\.project-badge\s*\{/.test(src);
    const mutedFallbacksPresent = [
      "var(--muted-color, #555)", "var(--muted-color, #777)", "var(--muted-color, #888)", "var(--muted-color, #666)",
    ].every((needle) => src.includes(needle));
    const noMutedCanonicalDefault = !/--muted-color:\s*#/.test(src);
    if (hasCanonicalRoot && inkUsedByHeader && inkUsedByBody && outlinedTag && noProjectBadgeClass && mutedFallbacksPresent && noMutedCanonicalDefault) {
      pass('cv-template.html wires the ink/muted design-token color layer, outlined competency tags, and no leftover project-badge pill');
    } else {
      fail(`cv-template.html design tokens: hasCanonicalRoot=${hasCanonicalRoot} inkUsedByHeader=${inkUsedByHeader} inkUsedByBody=${inkUsedByBody} outlinedTag=${outlinedTag} noProjectBadgeClass=${noProjectBadgeClass} mutedFallbacksPresent=${mutedFallbacksPresent} noMutedCanonicalDefault=${noMutedCanonicalDefault}`);
    }
  }

  // Template guard: the opt-in cv-template.varela.html declares the self-hosted
  // Varela Round @font-face, a --heading-font-family default that falls back to
  // --font-family (byte-identical unless a profile overrides it), applies it
  // ONLY to the name (h1) and section titles (not job titles/bullets, which stay
  // on the ATS-safe system stack), and references the real font file on disk.
  {
    const src = readFileSync(join(ROOT, 'templates/cv-template.varela.html'), 'utf-8');
    const hasFontFace = /@font-face\s*\{[^}]*font-family:\s*'Varela Round';[^}]*src:\s*url\('\.\/fonts\/varela-round\.woff2'\)\s*format\('woff2'\)/s.test(src);
    const hasDefault = /--heading-font-family:\s*var\(--font-family\);/.test(src);
    const headerUsesIt = /\.header h1\s*\{[^}]*font-family:\s*var\(--heading-font-family\)/s.test(src);
    const sectionUsesIt = /\.section-title\s*\{[^}]*font-family:\s*var\(--heading-font-family\)/s.test(src);
    // Job titles/bullets/company names must NOT read --heading-font-family — they
    // stay on --font-family so ATS-keyword-bearing text is unaffected.
    const jobUntouched = !/\.job-role\s*\{[^}]*var\(--heading-font-family\)/s.test(src)
      && !/\.job li\s*\{[^}]*var\(--heading-font-family\)/s.test(src)
      && !/\.job-company\s*\{[^}]*var\(--heading-font-family\)/s.test(src);
    const fontFileExists = existsSync(join(ROOT, 'fonts/varela-round.woff2'));
    if (hasFontFace && hasDefault && headerUsesIt && sectionUsesIt && jobUntouched && fontFileExists) {
      pass('cv-template.varela.html wires Varela Round to name/section-titles only, with a byte-identical default and the real font file present');
    } else {
      fail(`cv-template.varela.html: hasFontFace=${hasFontFace} hasDefault=${hasDefault} headerUsesIt=${headerUsesIt} sectionUsesIt=${sectionUsesIt} jobUntouched=${jobUntouched} fontFileExists=${fontFileExists}`);
    }
  }

  // Regression guard: the BASE cv-template.html (used by every profile that
  // doesn't opt into a named template) must NOT reference --heading-font-family
  // or the Varela Round font file — otherwise generate-pdf.mjs's inlineLocalFonts
  // would base64-embed an unused ~44KB font into every default CV.
  {
    const baseSrc = readFileSync(join(ROOT, 'templates/cv-template.html'), 'utf-8');
    const isClean = !baseSrc.includes('--heading-font-family') && !baseSrc.includes('varela-round.woff2');
    if (isClean) pass('cv-template.html (base) stays free of the opt-in Varela Round wiring — no bloat for other profiles');
    else fail('cv-template.html (base) leaked heading-font-family/varela-round references');
  }

  // Regression (post-review, #1837): injectPrintPageCss's @page rule used to
  // hardcode `margin: 0.6in`, which — injected last, right before </head> — won
  // the CSS cascade over the template's own `@page { margin: var(--page-margin) }`
  // and the theme override, silently making style.margin ineffective. Compose
  // the two injectors exactly as renderHtmlToPdf does and assert the page-setup
  // rule now reads the SAME variable (with 0.6in only as the final fallback), so
  // a --page-margin override earlier in <head> is what actually wins.
  {
    const { injectPrintPageCss } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
    const tplSrc = readFileSync(join(ROOT, 'templates/cv-template.html'), 'utf-8');
    const withOverride = injectPrintPageCss(injectThemeStyle(tplSrc, { '--page-margin': '0.5in' }), 'a4');
    const rootDefaultIdx = withOverride.indexOf('--page-margin: 0.6in');   // template's own :root default
    const overrideIdx = withOverride.indexOf('career-ops-dynamic-theme'); // the profile's style.margin override
    const pageSetupIdx = withOverride.indexOf('career-ops-page-setup');   // injectPrintPageCss's @page rule
    const pageSetupUsesVar = /@page \{ size: A4; margin: var\(--page-margin, 0\.6in\); \}/.test(withOverride);
    if (rootDefaultIdx !== -1 && rootDefaultIdx < overrideIdx && overrideIdx < pageSetupIdx && pageSetupUsesVar) {
      pass('injectPrintPageCss reads --page-margin instead of hardcoding it, so style.margin wins the cascade (#1837 review)');
    } else {
      fail(`page-margin cascade order/value wrong: root=${rootDefaultIdx} override=${overrideIdx} pageSetup=${pageSetupIdx} usesVar=${pageSetupUsesVar}`);
    }
  }
} catch (e) {
  fail(`theme-style tests crashed: ${e.message}`);
}
