import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source=await readFile(new URL('../v2-app.js',import.meta.url),'utf8');

test('backup and statistics export actions are present',()=>{
  for(const id of ['jsonOut','csvOut','xlsOut','sqlOut','statsCsv','statsExcel'])assert.match(source,new RegExp(`id=["']${id}["']`));
});

test('download attaches a link, clicks it, and releases the object URL',()=>{
  const match=source.match(/const download=(.*?);const csv=/s);
  assert.ok(match,'download helper should be present');
  const events=[];
  const context={
    Blob:class{constructor(parts,options){this.parts=parts;this.type=options.type}},
    URL:{createObjectURL(blob){events.push(['create',blob]);return'blob:test'},revokeObjectURL(url){events.push(['revoke',url])}},
    document:{body:{appendChild(){events.push(['append'])}},createElement(){return{style:{},click(){events.push(['click'])},remove(){events.push(['remove'])}}}},
    setTimeout(fn){fn()},alert(message){throw new Error(message)}
  };
  vm.runInNewContext(`globalThis.download=${match[1]}`,context);
  assert.equal(context.download('test.csv','姓名\n測試','text/csv;charset=utf-8'),true);
  assert.deepEqual(events.map(x=>x[0]),['create','append','click','remove','revoke']);
  assert.ok(events[0][1].parts[0].startsWith('\ufeff'),'CSV should include UTF-8 BOM');
});
