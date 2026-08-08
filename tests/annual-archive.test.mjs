import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source=await readFile(new URL('../v2-app.js',import.meta.url),'utf8');

test('年度清理只刪除指定日期範圍的病歷',()=>{
  const block=source.match(/async function deleteAnnualRecords\(year\).*?\n\}/s)?.[0]||'';
  assert.match(block,/from\('records'\)\.delete\(\{count:'exact'\}\)/);
  assert.match(block,/\.gte\('visit_date',start\)\.lt\('visit_date',end\)/);
  assert.doesNotMatch(block,/from\('patients'\).*delete/);
  assert.doesNotMatch(block,/from\('categories'\).*delete/);
});

test('年度封存包含病歷與可辨識的個案及分類資料',()=>{
  const block=source.match(/function annualArchiveDocument\(year,records\).*?\n\}/s)?.[0]||'';
  assert.match(block,/annual_medical_records/);
  assert.match(block,/categories,patients:archivePatients,records/);
  assert.match(block,/category_name:patientCategory\(p\)/);
});

test('必須先下載同年度備份並輸入確認文字才能清除',()=>{
  assert.match(source,/downloadedAnnualYear!==year/);
  assert.match(source,/phrase!==`清除 \$\{year\}`/);
  assert.match(source,/個案姓名資料夾、分類、帳號與設定均保留/);
});

test('刪除雲端備份不會觸發還原',()=>{
  const handler=source.match(/document\.querySelectorAll\('\[data-delete-backup\]'\).*?\n\};/s)?.[0]||'';
  assert.match(handler,/from\('backup_snapshots'\)\.delete\(\)\.eq\('id'/);
  assert.doesNotMatch(handler,/restore_case_library_backup/);
});
