#!/usr/bin/env node
/**
 * verify-cv-completeness.mjs
 *
 * Hard gate for generated CV HTML, run alongside verify-cv-facts.mjs before
 * any PDF is rendered (modes/pdf.md Step 19/19b; also wired into
 * generate-pdf.mjs so it can't be skipped by forgetting the doc step).
 *
 * Catches two specific regressions found 2026-09-28 across three batch-produced
 * CVs (reports #423, #424, #425):
 *
 *   1. Dropped Experience entries. modes/_custom.md's house rule requires every
 *      role in cv.md's `## Experience` section to appear in every generated
 *      CV/resume (compacted for old/low-relevance roles is fine; omitted is not).
 *      All three CVs silently dropped 3-4 of cv.md's 9 roles.
 *
 *   2. Stale end-dates / tense. One CV listed an ended role ("Ambush,
 *      February 2026 - July 2026" in cv.md) as still ongoing ("February 2026 -
 *      Current"), because the tailoring step re-derived dates instead of
 *      copying them from cv.md.
 *
 * This script does NOT replace verify-cv-facts.mjs (which checks that numeric/
 * metric claims trace back to a source). It checks structural completeness and
 * date fidelity instead: something a metric-focused fact-checker never covers.
 *
 * CLI usage:
 *   node verify-cv-completeness.mjs <cv-html-path> [--cv=cv.md]
 *
 * Exit 0: every cv.md role is present and no ended role is marked ongoing.
 * Exit 1: a role is missing, or an ended role's HTML date reads "Current"/
 *         "Present"/"Now" while cv.md gives it a concrete end date.
 *
 * Programmatic usage (generate-pdf.mjs):
 *   import { assertCompleteness } from './verify-cv-completeness.mjs';
 *   assertCompleteness(html, { cvMdPath, label: basename(inputPath) }); // throws on failure
 */
import { isMainModule } from "./lib/is-main-module.mjs";
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Extract {company, role, dates, ongoing} from cv.md's ## Experience section. */
function parseCvMdExperience(cvMdPath) {
  const text = readFileSync(cvMdPath, 'utf-8');
  const expSection = text.split(/^## Experience$/m)[1];
  if (!expSection) throw new Error(`No "## Experience" section found in ${cvMdPath}`);
  const body = expSection.split(/^## /m)[0];

  const entries = [];
  const headingRe = /^### (.+?)(?:\r?\n)/gm;
  const headings = [...body.matchAll(headingRe)];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i][1].trim();
    const startIdx = headings[i].index + headings[i][0].length;
    const endIdx = i + 1 < headings.length ? headings[i + 1].index : body.length;
    const block = body.slice(startIdx, endIdx);

    const [companyRaw, ...roleParts] = heading.split(/\s+—\s+/);
    const company = companyRaw.trim();
    const role = roleParts.join(' — ').trim();

    const dateMatch = block.match(/^\*\*(.+?)\*\*/m);
    const dates = dateMatch ? dateMatch[1].trim() : null;
    const ongoing = dates ? /\b(present|current|now)\b/i.test(dates) : false;

    entries.push({ company, role, dates, ongoing });
  }
  return entries;
}

function normalize(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents (Autônomo -> Autonomo)
    .replace(/[^a-z0-9]/g, '');
}

// "Self-employed" is sometimes localized (e.g. "Autônomo" in a pt-BR CV) --
// accept either the literal cv.md name or that one documented alias.
const ALIASES = { selfemployed: ['selfemployed', 'autonomo'] };

/**
 * Check a generated CV HTML string/path against cv.md's Experience section.
 * Returns { ok, missing, staleDates, sourceCount } and never throws by itself;
 * use assertCompleteness() for the hard-fail wrapper generate-pdf.mjs calls.
 */
export function checkCompleteness(htmlPathOrText, options = {}) {
  const cvMdPath = options.cvMdPath || join(__dirname, 'cv.md');
  const html = existsSync(htmlPathOrText) ? readFileSync(htmlPathOrText, 'utf-8') : htmlPathOrText;

  const sourceEntries = parseCvMdExperience(cvMdPath);
  const companyRe = /class="job-company">([^<]*)</g;
  const periodRe = /class="job-period">([^<]*)</g;
  const companies = [...html.matchAll(companyRe)].map(m => m[1].trim());
  const periods = [...html.matchAll(periodRe)].map(m => m[1].trim());
  const htmlEntries = companies.map((company, i) => ({ company, period: periods[i] || null }));

  const htmlByNorm = new Map();
  for (const e of htmlEntries) {
    const key = normalize(e.company);
    if (!htmlByNorm.has(key)) htmlByNorm.set(key, []);
    htmlByNorm.get(key).push(e);
  }

  const missing = [];
  const staleDates = [];
  const consumed = new Set();

  for (const src of sourceEntries) {
    const key = normalize(src.company);
    const candidateKeys = ALIASES[key] || [key];
    let match = null;
    for (const ck of candidateKeys) {
      const bucket = htmlByNorm.get(ck);
      if (bucket) {
        const free = bucket.find((_, idx) => !consumed.has(`${ck}#${idx}`));
        if (free) {
          match = free;
          consumed.add(`${ck}#${bucket.indexOf(free)}`);
          break;
        }
      }
    }
    if (!match) { missing.push(src); continue; }
    if (!src.ongoing && match.period && /\b(present|current|now)\b/i.test(match.period)) {
      staleDates.push({ company: src.company, sourceDate: src.dates, htmlDate: match.period });
    }
  }

  return { ok: missing.length === 0 && staleDates.length === 0, missing, staleDates, sourceCount: sourceEntries.length };
}

/** Throw when the CV drops a cv.md role or shows an ended role as ongoing. */
export function assertCompleteness(htmlPathOrText, options = {}) {
  const result = checkCompleteness(htmlPathOrText, options);
  if (!result.ok) {
    const details = [];
    if (result.missing.length) {
      details.push(`dropped ${result.missing.length}/${result.sourceCount} Experience entries: ${result.missing.map(m => m.company).join(', ')}`);
    }
    if (result.staleDates.length) {
      details.push(`stale end-date(s): ${result.staleDates.map(s => `${s.company} (cv.md: "${s.sourceDate}", CV: "${s.htmlDate}")`).join('; ')}`);
    }
    throw new Error(`CV completeness check failed${options.label ? ` for ${options.label}` : ''}: ${details.join('; ')}`);
  }
  return result;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--cv=')) args.cv = a.slice('--cv='.length);
    else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const htmlPath = args._[0];
  if (!htmlPath) {
    console.error('Usage: node verify-cv-completeness.mjs <cv-html-path> [--cv=cv.md]');
    process.exit(2);
  }
  if (!existsSync(htmlPath)) {
    console.error(`CV file not found: ${htmlPath}`);
    process.exit(2);
  }
  const cvMdPath = args.cv || join(__dirname, 'cv.md');
  if (!existsSync(cvMdPath)) {
    console.error(`Source cv.md not found: ${cvMdPath}`);
    process.exit(2);
  }

  const result = checkCompleteness(htmlPath, { cvMdPath });
  if (result.ok) {
    console.log(`CV completeness check passed: ${htmlPath}`);
    console.log(`  ${result.sourceCount}/${result.sourceCount} cv.md Experience entries present, no stale end-dates.`);
    process.exit(0);
  }

  console.error(`CV completeness check FAILED: ${htmlPath}`);
  if (result.missing.length > 0) {
    console.error(`\nDropped ${result.missing.length} of ${result.sourceCount} cv.md Experience entries (compact instead of omitting, per modes/_custom.md):`);
    for (const m of result.missing) console.error(`  - ${m.company} — ${m.role} (${m.dates || 'no dates'})`);
  }
  if (result.staleDates.length > 0) {
    console.error(`\nEnded role(s) shown as still ongoing (copy dates from cv.md verbatim, do not re-derive):`);
    for (const s of result.staleDates) console.error(`  - ${s.company}: cv.md says "${s.sourceDate}", CV says "${s.htmlDate}"`);
  }
  process.exit(1);
}

const isMain = isMainModule(import.meta.url);
if (isMain) main();
