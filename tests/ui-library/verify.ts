import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {colorRoles,type Theme} from "../../src/ui-library/tokens/index.ts";
import {kuramiTheme,themeCss,THEME_CSS} from "../../src/ui-library/themes/index.ts";
import {BRIEFING_STYLES} from "../../src/briefing/ui/styles.ts";
import {DOCS_STYLES} from "../../src/human-docs/styles.ts";

const root=resolve(import.meta.dirname,"../..");

// Every role is declared once per mode; light is the root mode.
for(const role of colorRoles){
  assert.match(THEME_CSS,new RegExp(`:root \\{[^}]*--${role}: #`),`light ${role}`);
  assert.match(THEME_CSS,new RegExp(`html\\[data-theme="dark"\\] \\{[^}]*--${role}: #`),`dark ${role}`);
}
assert.ok(BRIEFING_STYLES.startsWith(`\n${THEME_CSS}`)||BRIEFING_STYLES.includes(THEME_CSS),"Digest uses the library theme");
assert.ok(DOCS_STYLES.startsWith(THEME_CSS),"Docs uses the library theme");

// A new theme replaces values only; an incomplete one is rejected.
const inverted:Theme={name:"test",light:kuramiTheme.dark,dark:kuramiTheme.light};
assert.match(themeCss(inverted),/:root \{ color-scheme: dark;/);
const incomplete=structuredClone(kuramiTheme);
delete (incomplete.dark.colors as Partial<Record<string,string>>)["focus-ring"];
assert.throws(()=>themeCss(incomplete),/missing roles: focus-ring/);

// Components read semantic roles only: no retired names and no undefined custom properties.
const sources=execFileSync("git",["grep","--untracked","-hoE","-e","var\\(--[a-z0-9-]+","--","src/*.ts"],{cwd:root,encoding:"utf8"}).split("\n").filter(Boolean);
const retired=/^var\(--(paper|surface|panel|section|section-shadow|ink|muted|signal|signal-soft|line|grid|positive|warning|focus|docs-signal-text)$/;
assert.deepEqual(sources.filter(value=>retired.test(value)),[],"retired token names");
const known=new Set<string>([...colorRoles,"font-sans","font-mono","font-note"]);
const local=execFileSync("git",["grep","--untracked","-hoE","-e","--[a-z0-9-]+\\s*:","--","src/*.ts"],{cwd:root,encoding:"utf8"}).split("\n").map(value=>value.replace(/\s*:$/,"").slice(2)).filter(Boolean);
for(const name of local)known.add(name);
const undefinedNames=[...new Set(sources.map(value=>value.slice(6)))].filter(name=>!known.has(name));
assert.deepEqual(undefinedNames,[],"custom properties used without a definition");

console.log(`UI library theme contract verified: ${colorRoles.length} roles × 2 modes, no retired or undefined tokens`);
