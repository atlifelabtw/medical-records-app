import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source=await readFile(new URL('../v2-app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../v13-style.css',import.meta.url),'utf8');

test('病歷點選區可調整部位與處理方式順序',()=>{
  assert.match(source,/id="toggleBodyOrder"/);
  assert.match(source,/data-body-order-up/);
  assert.match(source,/data-body-order-down/);
  assert.match(source,/data-treatment-order-toggle/);
  assert.match(source,/data-treatment-order-up/);
  assert.match(source,/data-treatment-order-down/);
});

test('順序更新有指定資料列並使用低調控制樣式',()=>{
  assert.match(source,/\.update\(\{sort_order:bOrder\}\)\.eq\('id',a\.id\)/);
  assert.match(source,/\.update\(\{sort_order:aOrder\}\)\.eq\('id',b\.id\)/);
  assert.match(css,/\.pickerOrderToggle\{[^}]*font-size:13px/);
  assert.match(css,/\.pickerOrderControls button\{[^}]*width:30px/);
});

test('調整一次會同步全域清單並在重新讀取後沿用',()=>{
  assert.match(source,/masterList=list/);
  assert.match(source,/\[masterList\[mai\],masterList\[mbi\]\]=\[masterList\[mbi\],masterList\[mai\]\]/);
  assert.match(source,/activeTreatments,id,dir,\(\)=>true,treatmentOptions/);
  assert.match(source,/x=>x\.category===item\.category,bodyOptions/);
  assert.match(source,/from\('body_part_options'\)\.select\('\*'\)\.order\('sort_order'\)/);
  assert.match(source,/from\('treatment_options'\)\.select\('\*'\)\.order\('sort_order'\)/);
});
