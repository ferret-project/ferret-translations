/**
 * Machine drafts for a language, from DeepL — for a person to review, never shipped as they are.
 *
 *   DEEPL_API_KEY=… node tools/machine-draft.mjs pl            (or the key in ~/.config/ferret/deepl.key)
 *   node tools/machine-draft.mjs pl --limit 20                 try a few first
 *   node tools/machine-draft.mjs pl --dry                      show what would be sent, no DeepL
 *
 * Fills in what locales/<lang>.po doesn't have yet (it's made from messages.pot if it isn't there) and marks every
 * draft "Needs editing" (fuzzy): Ferret's builds leave those out, so nobody sees a draft until a reviewer approves it on
 * Weblate. Existing translations are never touched.
 *
 * Placeholders ({name}) and tags (<0>…</0>) go to DeepL as XML it keeps. A plural is translated once per plural form the
 * language has, as a whole sentence with a sample number (Polish: 1, 2, 5, 1.5 — "1 rzecz", "2 rzeczy", "5 rzeczy"), so
 * each form gets its own grammar. Anything whose placeholders or tags don't come back intact is left for a person.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { compileMessageOrThrow } from "@lingui/message-utils/compileMessage";
import { parsePo, stringifyPo } from "pofile-ts";

const args = process.argv.slice(2);
const lang = args.find((a) => !a.startsWith("--"));
const dry = args.includes("--dry");
const limit = Number(args[args.indexOf("--limit") + 1]) || Infinity;
if (!lang || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang)) {
  console.error("usage: node tools/machine-draft.mjs <language, e.g. pl> [--limit N] [--dry]");
  process.exit(1);
}

const ROOT = new URL("../locales/", import.meta.url).pathname;
const KEY_FILE = `${homedir()}/.config/ferret/deepl.key`;
const key = process.env.DEEPL_API_KEY || (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8").trim() : "");
if (!key && !dry) {
  console.error(`No DeepL key: set DEEPL_API_KEY, or put it in ${KEY_FILE}`);
  process.exit(1);
}
const API = key.endsWith(":fx") ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";
// DeepL's codes: PL, DE, PT-BR, EN-GB, ZH-HANS…
const TARGET = lang.toUpperCase();
const CONTEXT = "Text in the interface of Ferret, a home inventory app: short, plain and friendly, like a phone app's buttons and labels.";

// ── ICU (the subset Lingui writes): text, {name}, and at most one {n, plural, one {…} other {…}} ────────────────────
function parseMessage(msg) {
  const parts = [];
  let i = 0;
  let text = "";
  while (i < msg.length) {
    if (msg[i] !== "{") {
      text += msg[i++];
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < msg.length; j++) {
      if (msg[j] === "{") depth++;
      else if (msg[j] === "}" && --depth === 0) break;
    }
    if (text) parts.push({ type: "text", value: text }), (text = "");
    const inner = msg.slice(i + 1, j);
    const plural = /^\s*(\w+)\s*,\s*plural\s*,(.*)$/s.exec(inner);
    if (plural) parts.push({ type: "plural", name: plural[1], branches: parseBranches(plural[2]) });
    else if (/^\s*\w+\s*$/.test(inner)) parts.push({ type: "arg", name: inner.trim() });
    else throw new Error(`unsupported: {${inner}}`);
    i = j + 1;
  }
  if (text) parts.push({ type: "text", value: text });
  return parts;
}
function parseBranches(s) {
  const branches = {};
  const re = /\s*(=\d+|zero|one|two|few|many|other)\s*\{/y;
  let i = 0;
  while (i < s.length && s.slice(i).trim()) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new Error(`can't read plural branches: ${s}`);
    let depth = 1;
    let j = re.lastIndex;
    for (; j < s.length && depth; j++) depth += s[j] === "{" ? 1 : s[j] === "}" ? -1 : 0;
    branches[m[1]] = s.slice(re.lastIndex, j - 1);
    i = j;
  }
  return branches;
}

// ── To DeepL's XML and back ─────────────────────────────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Text with {name} and Lingui's <0>…</0> → XML: <x id="name"/> (kept as is) and <t0>…</t0>. */
function toXml(text) {
  let out = "";
  const re = /\{(\w+)\}|<(\/?)(\d+)\s*(\/?)>/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(last, m.index));
    out += m[1] !== undefined ? `<x id="${m[1]}"/>` : `<${m[2]}t${m[3]}${m[4]}>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}
function fromXml(xml) {
  return xml
    .replace(/<x id="(\w+)"\s*\/>|<x id="(\w+)"><\/x>/g, (_, a, b) => `{${a ?? b}}`)
    .replace(/<(\/?)t(\d+)\s*(\/?)>/g, (_, c, n, s) => `<${c}${n}${s}>`)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** A sample number for each plural form a language has (Polish: one 1, few 2, many 5, other 1.5). */
function samples(locale) {
  const rules = new Intl.PluralRules(locale);
  const out = {};
  for (const n of [1, 2, 5, 0, 3, 4, 6, 11, 12, 21, 22, 25, 100, 101, 102, 1.5, 0.5, 2.5]) {
    const cat = rules.select(n);
    if (!(cat in out)) out[cat] = n;
  }
  return out;
}
const englishBranch = (branches, n) => branches[`=${n}`] ?? branches[new Intl.PluralRules("en").select(n)] ?? branches.other;

/**
 * The units to translate for one message, and how to put the answers back together. Plain: one unit. A plural: one
 * whole sentence per plural form of the target language, with its sample number written in.
 */
function plan(msgid) {
  const parts = parseMessage(msgid);
  const plurals = parts.filter((p) => p.type === "plural");
  const flat = (ps, n) => ps.map((p) => (p.type === "text" ? p.value : p.type === "arg" ? `{${p.name}}` : englishBranch(p.branches, n).replaceAll("#", String(n)))).join("");
  // DeepL trims the ends: send without them and put them back (" · checking now").
  const ends = (text) => [/^\s*/.exec(text)[0], /\s*$/.exec(text)[0]];
  const send = (text) => toXml(text.trim());
  if (!plurals.length) {
    const [lead, trail] = ends(flat(parts));
    return { units: [send(flat(parts))], build: ([t]) => lead + fromXml(t).trim() + trail };
  }
  if (plurals.length > 1) throw new Error("more than one plural");
  const p = plurals[0];
  const forms = Object.entries(samples(lang));
  // English's own exact branches (=0) carry over as they are.
  const exact = Object.keys(p.branches).filter((k) => k.startsWith("="));
  const keys = [...exact, ...forms.map(([cat]) => cat)];
  const numbers = [...exact.map((k) => Number(k.slice(1))), ...forms.map(([, n]) => n)];
  return {
    units: numbers.map((n) => send(flat(parts, n))),
    build: (answers) => {
      const branches = answers.map((xml, i) => {
        const n = numbers[i];
        const [lead, trail] = ends(flat(parts, n));
        let text = lead + fromXml(xml).trim() + trail;
        // Only where the English form says the number ("# days"; not "a day", "every month").
        if (!keys[i].startsWith("=") && englishBranch(p.branches, n).includes("#")) {
          // The sample number back to #: 1.5 may come back as 1,5.
          const spelled = [String(n), String(n).replace(".", ","), new Intl.NumberFormat(lang).format(n)];
          const found = spelled.find((s) => text.includes(s));
          if (!found) throw new Error(`the number ${n} didn't come back: ${text}`);
          text = text.replace(found, "#");
        }
        return `${keys[i]} {${text}}`;
      });
      return `{${p.name}, plural, ${branches.join(" ")}}`;
    },
  };
}

/** Same placeholders and tags as the English (as Ferret's build checks: apps/web/scripts/translations.mjs). */
function shape(message) {
  const names = [];
  const walk = (tokens) => {
    for (const t of tokens) {
      if (!Array.isArray(t)) continue;
      names.push(t[0]);
      if (t[2] && typeof t[2] === "object") for (const [k, v] of Object.entries(t[2])) if (k !== "offset" && Array.isArray(v)) walk(v);
    }
  };
  walk(compileMessageOrThrow(message));
  const tags = message.match(/<\/?\d+\s*\/?>/g) ?? [];
  return JSON.stringify([[...new Set(names)].sort(), [...new Set(tags.map((t) => t.replace(/\s/g, "")))].sort()]);
}

async function deepl(texts) {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: texts,
      source_lang: "EN",
      target_lang: TARGET,
      tag_handling: "xml",
      ignore_tags: ["x"],
      formality: "prefer_less",
      context: CONTEXT,
    }),
  });
  if (!res.ok) throw new Error(`DeepL: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).translations.map((t) => t.text);
}

// ── The catalog ─────────────────────────────────────────────────────────────────────────────────────────────────────
const pot = parsePo(readFileSync(`${ROOT}messages.pot`, "utf8"));
const file = `${ROOT}${lang}.po`;
const po = existsSync(file) ? parsePo(readFileSync(file, "utf8")) : parsePo(readFileSync(`${ROOT}messages.pot`, "utf8"));
if (!existsSync(file)) {
  po.items = [];
  po.headers = { ...po.headers, Language: lang, "MIME-Version": "1.0", "Content-Type": "text/plain; charset=UTF-8", "Content-Transfer-Encoding": "8bit" };
}
const byId = new Map(po.items.map((i) => [i.msgid, i]));
const todo = [];
for (const source of pot.items) {
  if (!source.msgid) continue;
  let item = byId.get(source.msgid);
  if (!item) {
    item = { ...source, msgstr: [""], flags: {} };
    po.items.push(item);
    byId.set(source.msgid, item);
  }
  if (!item.msgstr[0] && todo.length < limit) todo.push(item);
}

const jobs = [];
const skipped = [];
for (const item of todo) {
  try {
    jobs.push({ item, ...plan(item.msgid) });
  } catch (e) {
    skipped.push(`  ${item.msgid}  (${e.message})`);
  }
}
const units = jobs.flatMap((j) => j.units);
const chars = units.reduce((n, u) => n + u.length, 0);
console.log(`${lang}: ${todo.length} to draft — ${units.length} pieces, ~${chars.toLocaleString()} characters to DeepL`);
if (dry) {
  for (const j of jobs.slice(0, 15)) console.log(`  ${j.item.msgid}\n    → ${j.units.join("\n    → ")}`);
  process.exit(0);
}

const answers = [];
for (let i = 0; i < units.length; i += 50) {
  answers.push(...(await deepl(units.slice(i, i + 50))));
  process.stdout.write(`\r  ${Math.min(i + 50, units.length)} / ${units.length}`);
}
console.log();

let done = 0;
let at = 0;
for (const j of jobs) {
  const mine = answers.slice(at, at + j.units.length);
  at += j.units.length;
  try {
    const text = j.build(mine);
    if (shape(text) !== shape(j.item.msgid)) throw new Error(`placeholders or tags changed: ${text}`);
    j.item.msgstr = [text];
    j.item.flags = { ...j.item.flags, fuzzy: true };
    done++;
  } catch (e) {
    skipped.push(`  ${j.item.msgid}  (${e.message})`);
  }
}

// messages.pot's order, so the file diffs cleanly.
const order = new Map(pot.items.map((it, i) => [it.msgid, i]));
po.items.sort((a, b) => (order.get(a.msgid) ?? 1e9) - (order.get(b.msgid) ?? 1e9));
writeFileSync(file, stringifyPo(po));
console.log(`${lang}.po: ${done} drafts written, marked "Needs editing"`);
if (skipped.length) console.log(`Left for a person (${skipped.length}):\n${skipped.join("\n")}`);
