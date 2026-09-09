import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source=await readFile(new URL('../v2-app.js',import.meta.url),'utf8');
function app(data={}){
  const elements=new Map();
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{value:selector==='#sort'?'updated':'',innerHTML:'',textContent:'',hidden:false,
      classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},addEventListener(){},querySelectorAll:()=>[],focus(){}});
    return elements.get(selector);
  };
  const sb={auth:{getSession:async()=>({data:{session:null}})},
    from:table=>({select(){return this},order:async()=>({data:structuredClone(data[table]||[])})}),rpc:async()=>({data:[]})};
  const context=vm.createContext({document:{querySelector:element,querySelectorAll:()=>[],addEventListener(){},body:element('body')},
    window:{sb,addEventListener(){},matchMedia:()=>({matches:false})},localStorage:{getItem:()=>null},
    history:{replaceState(){}},location:{hash:'#search'},setTimeout(){},alert(message){throw new Error(message)}});
  vm.runInContext(source,context);
  return{context,elements,run:code=>vm.runInContext(code,context),load:()=>vm.runInContext('load()',context),
    search:query=>{element('#globalSearch').value=query;vm.runInContext('renderFolders({search:true})',context);return element('#workspace').innerHTML}};
}
const fixture=()=>({categories:[{id:'pitcher',name:'投手'},{id:'empty',name:'離隊'}],patients:[
  {id:'a',name:'測試甲',category_id:'pitcher',created_at:'2026-09-01T02:03:04Z',records:[{id:'r',visit_date:'2026-09-09',body_part:'右踝',treatment:'BFR',notes:'備註 Alpha'}]},
  {id:'b',name:'測試乙',category_id:null,created_at:'2026-09-02T00:00:00Z',records:[]},
  {id:'c',name:'測試丙',category_id:'missing',created_at:'2026-09-03T00:00:00Z',records:null}
]});
test('搜尋維持姓名、分類、日期、部位、處理方式及備註結果，空白不列個案',async()=>{
  const a=app(fixture());await a.load();
  assert.doesNotMatch(a.search('   '),/data-patient=/);
  for(const query of ['測試甲','投手','2026-09-09','右踝','bfr','ALPHA','"id":"r"']){
    const html=a.search(query);assert.match(html,/data-patient="a"/);assert.doesNotMatch(html,/data-patient="[bc]"/);
  }
  assert.match(a.search('右踝'),/符合紀錄：2026\/09\/09/);
  assert.match(a.search('未分類'),/data-patient="b"/);
  assert.match(a.search('未分類'),/data-patient="c"/);
  assert.doesNotMatch(a.search('沒有此內容'),/data-patient=/);
});
test('修改後重新讀取會更新搜尋快取，不留下舊姓名、分類或病歷內容',async()=>{
  const data=fixture(),a=app(data);await a.load();a.search('Alpha');
  data.categories[0].name='新分類';data.patients[0].name='新名稱';data.patients[0].records[0].notes='Beta';
  await a.load();
  for(const query of ['新名稱','新分類','Beta'])assert.match(a.search(query),/data-patient="a"/);
  for(const query of ['測試甲','投手','Alpha'])assert.doesNotMatch(a.search(query),/data-patient="a"/);
  data.patients.splice(0,1);await a.load();assert.doesNotMatch(a.search('Beta'),/data-patient=/);
});
test('連續輸入重用暫存文字，不反覆序列化相同病歷',async()=>{
  const a=app(fixture());await a.load();
  a.run('globalThis.serializations=0;const originalStringify=JSON.stringify;JSON.stringify=(...args)=>{serializations++;return originalStringify(...args)}');
  a.search('右');const first=a.run('serializations');
  a.search('右踝');a.search('右踝X');a.search('右');
  assert.equal(a.run('serializations'),first);assert.ok(first>0);
});
test('首頁與個案庫分類數量正確，首頁沒有個案姓名',async()=>{
  const data=fixture(),a=app(data);await a.load();
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(libraryEntries())')),[
    {id:'all',name:'全部個案',count:3},{id:'uncategorized',name:'未分類',count:1},
    {id:'pitcher',name:'投手',count:1},{id:'empty',name:'離隊',count:0}]);
  a.run('renderDashboard()');let html=a.elements.get('#workspace').innerHTML;
  assert.doesNotMatch(html,/測試[甲乙丙]|data-patient=|右踝/);assert.match(html,/<small>3 位<\/small>/);
  data.categories.push({id:'uncat',name:'未分類'});await a.load();
  assert.equal(a.run("libraryEntries().filter(c=>c.name==='未分類').length"),1);
});
test('日期格式與原本本地時間顯示相同，包含舊資料與無效時間',()=>{
  const a=app();
  for(const value of ['2026-09-09T00:00:00Z','2026-01-01T16:01:59Z','2024-02-29','2026-03-08T07:00:00Z','bad-date',null,'',0]){
    a.context.value=value;
    assert.equal(a.run('formatDateTime(value)'),a.run("value?new Date(value).toLocaleString('zh-TW',{hour12:false}):'尚無時間'"));
    assert.equal(a.run('localDateKey(value)'),a.run("value?new Date(value).toLocaleDateString('sv-SE'):''"));
  }
});
test('最近使用入口數量與既有清單一致，並保留最多 20 位規則',async()=>{
  const data=fixture();data.patients=Array.from({length:27},(_,i)=>({...data.patients[0],id:String(i)}));
  const a=app(data);await a.load();a.run('renderDashboard()');
  assert.equal(a.run('recentPatientItems(20).length'),20);
  assert.match(a.elements.get('#workspace').innerHTML,/<small>20 位<\/small>/);
});
