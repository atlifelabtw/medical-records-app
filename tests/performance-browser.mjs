// Isolated browser regression check. All Supabase requests use synthetic fixtures.
// PLAYWRIGHT_MODULE may point to a locally bundled Playwright installation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const baseline='66a74bd08ccad97c6d6badd6418021809b5519a3';
const fixedTime='2026-09-09T02:35:00.000Z';
const errors=[];
const server=createServer(async(req,res)=>{
  try{
    const [version,...parts]=new URL(req.url,'http://localhost').pathname.slice(1).split('/');
    const name=parts.join('/')||'index.html';
    if(!['before','after'].includes(version)||!/^[-\w.]+$/.test(name))throw new Error('Invalid fixture path');
    const body=version==='before'?execFileSync('git',['show',`${baseline}:${name}`],{cwd:root}):await readFile(new URL(name,new URL('../',import.meta.url)));
    res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'text/html','Cache-Control':'no-store'});res.end(body);
  }catch{res.writeHead(404);res.end('Not found')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
function fixture(role='super_admin'){
  const member={id:'member-test',display_name:'測試管理員',email:'fixture@example.invalid',role,active:true,permissions:{},member_color:'#3F6B8A'};
  return{member,categories:[{id:'pitcher',name:'投手',sort_order:0},{id:'coach',name:'教練',sort_order:1}],
    body_part_options:[{id:'ankle',name:'踝',category:'下肢',side_rule:'required',sort_order:0,is_active:true}],
    treatment_options:[{id:'bfr',name:'BFR',sort_order:0,is_active:true,usage_count:12,created_at:fixedTime}],
    patients:Array.from({length:12},(_,i)=>({id:`p${i}`,name:`虛擬個案${i}`,category_id:i<8?'pitcher':i<11?'coach':null,
      created_at:'2026-09-01T00:00:00Z',updated_at:fixedTime,created_by:member.id,updated_by:member.id,
      records:[{id:`r${i}`,patient_id:`p${i}`,visit_date:'2026-09-09',body_part:'右踝',treatment:'BFR',notes:`測試備註 ${i}`,
        created_at:fixedTime,updated_at:fixedTime,created_by:member.id,updated_by:member.id,
        record_body_parts:[{id:`b${i}`,body_part_option_id:'ankle',side:'right',display_name:'右踝',notes:'局部備註',sort_order:0,
          record_body_part_treatments:[{treatment_option_id:'bfr',display_name:'BFR',sort_order:0}]}]}]}))};
}
async function session(viewport,role='super_admin'){
  const data=fixture(role),requests=[];
  const context=await browser.newContext({viewport,locale:'zh-TW',timezoneId:'Asia/Taipei',hasTouch:viewport.width<=1024});
  await context.addInitScript(()=>localStorage.setItem('medical_session',JSON.stringify({access_token:'synthetic-test-session'})));
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin)return route.continue();
    if(url.hostname!=='ethrejmgwrizrsxqwjhz.supabase.co'){errors.push(`Blocked unexpected host: ${url.hostname}`);return route.abort()}
    requests.push({path:url.pathname,method:request.method(),body:request.postDataJSON()});
    const name=url.pathname.split('/').at(-1);
    let result=[];
    if(name==='get_my_profile')result=data.member;
    else if(name==='get_member_directory')result=[data.member];
    else if(data[name])result=data[name];
    else if(!['mark_current_login','write_audit','backup_snapshots','activity_logs'].includes(name))errors.push(`Unexpected mock API: ${name}`);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage();await page.clock.setFixedTime(new Date(fixedTime));
  page.on('pageerror',error=>errors.push(error.message));
  return{context,page,data,requests};
}
async function snapshot(page){
  return page.evaluate(()=>({html:document.querySelector('#app').innerHTML,modal:document.querySelector('#modal').innerHTML,
    layout:[...document.querySelectorAll('#app *,#modal[open] *')].map(el=>{
      const style=getComputedStyle(el),box=el.getBoundingClientRect();
      return[el.tagName,...['display','position','color','backgroundColor','fontSize','fontWeight','padding','margin','gap','border','borderRadius','gridTemplateColumns','overflowX'].map(p=>style[p]),...[box.x,box.y,box.width,box.height].map(n=>Math.round(n*100)/100)];
    })}));
}
async function downloadText(page,selector){
  const ready=page.waitForEvent('download');await page.locator(selector).click();const download=await ready;
  const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
  return{filename:download.suggestedFilename(),text:Buffer.concat(chunks).toString('utf8')};
}
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  let comparisons=0;
  for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:1440,height:900}]){
    const results=[];
    for(const version of ['before','after']){
      const {context,page}=await session(viewport);const states=[],styles=[];
      page.on('request',r=>{if(r.resourceType()==='stylesheet')styles.push(r.url())});
      await page.goto(`${origin}/${version}/#home`);await page.locator('.homeCategory').first().waitFor();
      assert.equal(await page.locator('#workspace [data-patient]').count(),0);
      assert.equal(await page.locator('[data-home-category="all"] b').textContent(),'12');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      states.push(await snapshot(page));
      if(version==='after')assert.equal(styles.length,1);else assert.equal(styles.length,12);
      // Real clicks: category entry, single-click patient entry, edit and cancel.
      await page.locator('[data-home-category="pitcher"]').click();assert.equal(await page.locator('[data-patient]').count(),8);
      states.push(await snapshot(page));
      await page.locator('[data-patient="p0"]').click();await page.locator('#addRecord').waitFor();
      states.push(await snapshot(page));
      await page.locator('.recordFile > summary').click();await page.locator('[data-edit="r0"]').click();
      await page.locator('#modal[open]').waitFor();states.push(await snapshot(page));await page.locator('#cancel').click();
      await page.locator('#homeBrand').click();await page.locator('#homeSearchInput').fill('右踝');await page.locator('#homeSearchInput').press('Enter');
      assert.equal(await page.locator('[data-patient]').count(),12);states.push(await snapshot(page));
      await page.locator('#globalSearch').fill('虛擬個案3');assert.equal(await page.locator('[data-patient]').count(),1);
      states.push(await snapshot(page));await page.locator('#globalSearch').fill('');assert.equal(await page.locator('[data-patient]').count(),0);
      states.push(await snapshot(page));
      await page.locator('#homeBrand').click();await page.locator('[data-home-action="recent"]').click();states.push(await snapshot(page));
      await page.locator('#headerSettings').click();states.push(await snapshot(page));
      await page.locator('[data-setting="data"]').click();await page.locator('#jsonOut').waitFor();states.push(await snapshot(page));
      const backup=await downloadText(page,'#jsonOut');const exported=JSON.parse(backup.text.replace(/^\uFEFF/,''));
      assert.equal(exported.patients.length,12);assert.equal(exported.records.length,12);
      await page.locator('#cancel').click();await page.locator('[data-setting="stats"]').click();await page.locator('#statsCsv').waitFor();
      const statistics=await downloadText(page,'#statsCsv');assert.match(statistics.text,/BFR/);
      await page.locator('#cancel').click();
      await page.locator('#homeBrand').click();await page.locator('[data-home-action="new-patient"]').click();
      await page.locator('#modal[open] input[name="name"]').waitFor();await page.locator('#cancel').click();
      // Mobile/tablet menu must close after one selection.
      if(await page.locator('#mobileMenu').isVisible()){
        await page.locator('#mobileMenu').click();await page.locator('[data-nav="library"]').click();
        assert.equal(await page.locator('#mobileMenu').getAttribute('aria-expanded'),'false');
      }
      results.push(states);await context.close();
    }
    assert.deepEqual(results[1],results[0],`DOM and computed styles differ at ${viewport.width}px`);
    comparisons+=results[0].length;
    console.log(`PASS ${viewport.width}×${viewport.height}: identical UI; search, navigation, forms, JSON and statistics exports`);
  }
  // Compare full render work on the same synthetic dataset; timings are informational.
  for(const version of ['before','after']){
    const {context,page}=await session({width:1440,height:900});
    await page.goto(`${origin}/${version}/#home`);await page.locator('.homeCategory').first().waitFor();
    const timing=await page.evaluate(()=>{
      const template=patients[0];patients=Array.from({length:300},(_,i)=>({...template,id:`bench-${i}`,name:`效能測試${i}`,
        records:Array.from({length:30},(_,j)=>({...template.records[0],id:`bench-${i}-${j}`,notes:`效能測試備註 ${i} ${j}`}))}));
      if(typeof resetSearchCache==='function')resetSearchCache();
      const start=performance.now();for(let i=0;i<10;i++)renderDashboard();const home=performance.now()-start;
      const queries=['效','效能','效能測','效能測試','右','右踝','BFR','沒有符合'];
      const searchStart=performance.now();
      for(const query of queries){document.querySelector('#globalSearch').value=query;renderFolders({search:true})}
      return{home10Ms:Math.round(home),search8Ms:Math.round(performance.now()-searchStart),patients:patients.length,records:patients.length*30};
    });
    console.log(`BENCHMARK ${version}: ${JSON.stringify(timing)}`);await context.close();
  }
  // The optimized entry points must keep existing subadministrator restrictions.
  const {context,page}=await session({width:390,height:844},'sub_admin');
  await page.goto(`${origin}/after/#settings`);await page.locator('.settingsSection').first().waitFor();
  for(const key of ['accounts','data','categories','body-parts','treatments'])assert.equal(await page.locator(`[data-setting="${key}"]`).count(),0);
  assert.equal(await page.locator('[data-setting="activity"]').count(),1);await context.close();
  assert.deepEqual(errors,[]);
  console.log(`PASS ${comparisons} before/after UI comparisons; no real backend requests; permissions unchanged`);
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
