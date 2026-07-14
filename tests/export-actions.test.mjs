import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source=await readFile(new URL('../v2-app.js',import.meta.url),'utf8');

test('backup and statistics export actions are present',()=>{
  for(const id of ['jsonOut','csvOut','xlsOut','sqlOut','statsCsv','statsExcel'])assert.match(source,new RegExp(`id=["']${id}["']`));
});

test('download keeps a visible fallback link when automatic download is blocked',()=>{
  const match=source.match(/let activeExportUrl=.*?;const csv=/s);
  assert.ok(match,'download helper should be present');
  const events=[];
  let fallbackLink;
  const makeElement=tag=>({
    tag,children:[],className:'',id:'',style:{},
    setAttribute(){},
    replaceChildren(){this.children=[]},
    append(...children){this.children.push(...children);fallbackLink=children.find(x=>x.tag==='a')||fallbackLink},
    click(){events.push(['click'])},
    removeAttribute(name){delete this[name]}
  });
  const context={
    Blob:class{constructor(parts,options){this.parts=parts;this.type=options.type}},
    URL:{createObjectURL(blob){events.push(['create',blob]);return'blob:test'},revokeObjectURL(url){events.push(['revoke',url])}},
    document:{body:{appendChild(element){events.push(['append-host']);this.child=element}},createElement:makeElement},
    $(){return null},
    setTimeout(fn,delay){events.push(['scheduled',delay,fn])},
    alert(message){throw new Error(message)}
  };
  vm.runInNewContext(`${match[0].slice(0,-';const csv='.length)};globalThis.download=download`,context);
  assert.equal(context.download('test.csv','姓名\n測試','text/csv;charset=utf-8'),true);
  assert.deepEqual(events.map(x=>x[0]),['create','append-host','click','scheduled']);
  assert.ok(events[0][1].parts[0].startsWith('\ufeff'),'CSV should include UTF-8 BOM');
  assert.equal(fallbackLink.download,'test.csv');
  assert.equal(fallbackLink.target,'_blank');
  assert.equal(fallbackLink.href,'blob:test');
  assert.ok(events[3][1]>=300000,'fallback link must remain usable long enough for mobile browsers');
});
