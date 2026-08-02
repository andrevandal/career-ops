#!/usr/bin/env node
/**
 * theme-style.mjs — dynamic CV/cover-letter theming from config/profile.yml (#1837)
 *
 * Users declare a `style:` block in config/profile.yml:
 *
 *   style:
 *     accent_color: "#2563eb"
 *     font_family:  "Outfit, Inter, sans-serif"
 *     font_size:    "10pt"
 *     margin:       "0.5in"
 *     heading1_size:            "30px"     # name/header
 *     heading1_weight:          "800"
 *     heading2_size:            "13px"     # section titles (WORK EXPERIENCE, ...)
 *     heading2_weight:          "700"
 *     heading2_letter_spacing:  "0.08em"
 *     heading3_size:            "13px"     # entry titles (job company name)
 *     heading3_weight:          "600"      # shared by job company + job role
 *     body_line_height:         "1.5"      # base body text (#tiered-detail follow-up)
 *     body_color:               "#222"     # shared "normal text" color (job bullets,
 *                                           # role/title text, education, certifications, skills)
 *     heading_font_family:      "'Varela Round', sans-serif"  # heading-only font (name +
 *                                           # section titles) — opt-in template only, see
 *                                           # templates/cv-template.varela.html
 *     ink_color:                "#040B0E"  # name (h1) + base body text color — the
 *                                           # "brand ink" tier, distinct from body_color
 *     accent_tint_bg:           "#CCECE5"  # competency-tag / project-badge pill background
 *     accent_tint_border:       "#99D9CC"  # competency-tag pill border
 *     muted_color:              "#747673"  # secondary/de-emphasized text — dates, periods,
 *                                           # locations, tech tags, contact row
 *
 * These are injected as CSS custom properties into the rendered HTML before it
 * hits the PDF pipeline. The templates read them via `var(--x, <default>)`, so a
 * profile with no `style:` block produces byte-identical output — this only ever
 * *overrides* the template defaults, never changes the baseline.
 *
 * Pure + dependency-light (js-yaml only) so it's unit-testable without Playwright.
 */
import { readFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';

// Recognized style tokens → the CSS custom property each maps to. Anything not
// listed here is ignored, so a typo or an unrelated `style:` key is inert.
export const STYLE_VAR_MAP = {
  accent_color: '--accent-color',
  font_family:  '--font-family',
  font_size:    '--font-size',
  margin:       '--page-margin',
  // Heading levels (#tiered-detail follow-up): name/h1, section titles/h2, and
  // entry titles/h3 (job company name — job role shares heading3_weight but
  // keeps reading font_size for its own text size, since it IS body-size text).
  heading1_size:           '--heading1-size',
  heading1_weight:         '--heading1-weight',
  heading2_size:           '--heading2-size',
  heading2_weight:         '--heading2-weight',
  heading2_letter_spacing: '--heading2-letter-spacing',
  heading3_size:           '--heading3-size',
  heading3_weight:         '--heading3-weight',
  // Normal/body text: the shared color across job bullets, role/entry titles,
  // education, certifications, and skills (they all rendered the same literal
  // #333 before this token existed — this just gives that shared value a name).
  body_line_height:        '--body-line-height',
  body_color:              '--body-color',
  // Heading-only font override (opt-in, requires a template that declares an
  // @font-face for it and reads var(--heading-font-family) — see
  // templates/cv-template.varela.html). Ignored by the base cv-template.html,
  // which has no --heading-font-family consumer and stays byte-identical.
  heading_font_family:     '--heading-font-family',
  // Design-token color layer (#personalization, 2026-07-31): a small palette
  // beyond the single accent/body pair above, for users bringing their own
  // brand tokens (e.g. a named green/dark-blue/gray scale). Color choice never
  // affects ATS text extraction (that's font/structure, not color) — the only
  // requirement enforced here is via the existing WCAG-safe defaults; pick
  // your own values with enough contrast against white to stay legible.
  ink_color:               '--ink-color',
  accent_tint_bg:          '--accent-tint-bg',
  accent_tint_border:      '--accent-tint-border',
  muted_color:             '--muted-color',
};

/**
 * Read the recognized `style:` tokens from a profile file into a
 * { '--css-var': 'value' } map. Missing file / absent block / bad YAML → {}.
 * @param {string} [profilePath]
 * @returns {Record<string,string>}
 */
export function readStyleTokens(profilePath = 'config/profile.yml') {
  try {
    if (!existsSync(profilePath)) return {};
    const raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    return styleTokensFrom(raw?.style);
  } catch {
    return {};
  }
}

/**
 * Map a parsed `style:` object to { '--css-var': value }, keeping only the
 * recognized string tokens. Exported for tests.
 * @param {unknown} style
 * @returns {Record<string,string>}
 */
export function styleTokensFrom(style) {
  const out = {};
  if (!style || typeof style !== 'object' || Array.isArray(style)) return out;
  for (const [key, cssVar] of Object.entries(STYLE_VAR_MAP)) {
    const v = style[key];
    if (typeof v === 'string' && v.trim()) out[cssVar] = v.trim();
  }
  return out;
}

/**
 * Build a `<style>` block declaring the custom properties on :root, or '' when
 * there is nothing to declare. Values containing CSS/HTML control characters
 * (`; { } < >`) are dropped — a custom-property value can't legitimately contain
 * them, and allowing them would let a profile break out of the rule or the tag.
 * @param {Record<string,string>} tokens
 * @returns {string}
 */
export function buildThemeStyleBlock(tokens) {
  const decls = Object.entries(tokens || {})
    .filter(([, v]) => typeof v === 'string' && v.trim() && !/[;{}<>]/.test(v))
    .map(([cssVar, v]) => `${cssVar}: ${v.trim()};`)
    .join(' ');
  if (!decls) return '';
  return `<style id="career-ops-dynamic-theme">:root { ${decls} }</style>`;
}

/**
 * Inject the theme block into an HTML string so it overrides the template's own
 * :root defaults (later declaration wins for custom properties). Inserted just
 * before </head>, or prepended when there is no head. A no-op when there are no
 * tokens, so callers can pass it unconditionally.
 * @param {string} html
 * @param {Record<string,string>} tokens
 * @returns {string}
 */
export function injectThemeStyle(html, tokens) {
  const block = buildThemeStyleBlock(tokens);
  if (!block) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}\n</head>`);
  return `${block}\n${html}`;
}
