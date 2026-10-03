import assert from "node:assert/strict";
import {publicDigestUrl} from "../../src/briefing/public-url.ts";
import {resolveWebRoute} from "../../src/web/routes.ts";
for(const lang of ["en","ru"] as const)for(const path of ["/daily/2026-10-03","/cinema","/weekly","/stocks"]){
  const value=publicDigestUrl(path,lang,{}),url=new URL(value);
  assert.equal(url.origin,"https://kurami.shagon1k.win");assert.equal(url.pathname,`/${lang}/digest${path}`);
  assert.deepEqual(resolveWebRoute(url.pathname),{app:"digest",language:lang,upstream:`/${lang}${path}`});
  assert.equal(publicDigestUrl(path,lang,{BRIEFING_PUBLIC_BASE_URL:"https://digest.shagon1k.win"}),value);
}
assert.equal(publicDigestUrl("/en/stocks?period=month#review","ru",{}),"https://kurami.shagon1k.win/en/digest/stocks?period=month#review");
assert.equal(publicDigestUrl("/stocks","ru",{BRIEFING_PUBLIC_BASE_URL:"https://preview.example/digest"}),"https://preview.example/digest/stocks");
assert.throws(()=>publicDigestUrl("/stocks","ru",{BRIEFING_PUBLIC_BASE_URL:"https://owner:secret@example.com"}),/credential-free/);
console.log("Digest public URLs: canonical EN/RU routes, retained legacy config migration, query/anchor preservation and preview override verified");
