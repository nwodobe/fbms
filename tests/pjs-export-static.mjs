#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const js = readFileSync('operations/pjs-export.js','utf8');
const html = readFileSync('operations/reports.html','utf8');

assert.match(js,/ExcelJS/,'ExcelJS engine required');
assert.match(js,/053B23/,'PJS forest brand required');
assert.match(js,/EXPORT_INFO/,'EXPORT_INFO sheet required');
assert.match(js,/DATA_DICTIONARY/,'DATA_DICTIONARY sheet required');
assert.match(js,/01_EXECUTIVE_SUMMARY/,'Executive summary required');
assert.match(js,/\^\[=\+\\-@\]/,'Formula-injection guard required');
assert.doesNotMatch(js,/service_role/i,'service_role must never be exposed by export client');
for (const key of ['producers','villages','rts','cooperatives','coop_members','suppliers','purchases','advances','bags','procurement','delivery_plans','warehouse_receptions','quality','warehouse_lots','warehouse_bins','transfers','factory_receptions','traceability','sustainability']) {
  assert.ok(js.includes("reg('"+key+"'") || js.includes("simple('"+key+"'"), 'missing dataset '+key);
}
assert.match(js,/campaign_id/,'campaign scoping required');
assert.match(js,/navigator\.onLine===false/,'official export must guard offline state');
assert.match(html,/id="pjsExportCenter"/,'Reports page must expose PJS Export Center');
assert.match(html,/pjs-export\.js/,'Reports page must load the PJS export engine');
console.log(JSON.stringify({result:'PASS',datasets:19,brand:'#053B23',formula_injection:true,multi_campaign:true}));
