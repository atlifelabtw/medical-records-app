import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
const normalizeLogin=(value:unknown)=>String(value||'').trim().toLowerCase()
const validLogin=(value:string)=>/^[a-z0-9][a-z0-9._-]{2,31}$/.test(value)

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  try{
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const token=req.headers.get('Authorization')||''
    const caller=createClient(url,anon,{global:{headers:{Authorization:token}}})
    const {data:{user}}=await caller.auth.getUser()
    if(!user)return reply({error:'登入狀態已過期，請重新登入'},401)
    const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}})
    const {data:me}=await admin.from('profiles').select('role,active').eq('id',user.id).single()
    if(!me?.active||me.role!=='super_admin')return reply({error:'只有主管理員可以執行此操作'},403)
    const b=await req.json(),action=b.action
    const loginName=normalizeLogin(b.login_name)
    if(action==='list'){
      // 修復「Auth 已建立，但 profiles 寫入失敗」的孤立子帳號。
      const {data:authPage,error:authError}=await admin.auth.admin.listUsers({page:1,perPage:1000})
      if(authError)return reply({error:authError.message},400)
      const {data:existing}=await admin.from('profiles').select('id,login_name')
      const ids=new Set((existing||[]).map(x=>x.id))
      const used=new Set((existing||[]).map(x=>normalizeLogin(x.login_name)))
      const missing=(authPage.users||[]).filter(x=>!ids.has(x.id)&&x.email)
      for(const x of missing){
        let base=normalizeLogin(x.email!.split('@')[0]).replace(/[^a-z0-9._-]/g,'').slice(0,32)
        if(!validLogin(base))base=`user-${x.id.slice(0,8)}`
        let candidate=base,n=2
        while(used.has(candidate)){candidate=`${base.slice(0,28)}-${n++}`}
        used.add(candidate)
        const {error:repairError}=await admin.from('profiles').upsert({id:x.id,email:x.email,login_name:candidate,display_name:x.email!.split('@')[0],role:'sub_admin',active:true,must_change_password:true,permissions:{}})
        if(repairError)return reply({error:`修復帳號 ${x.email} 失敗：${repairError.message}`},400)
      }
      const {data,error}=await admin.from('profiles').select('*').order('created_at')
      if(error)return reply({error:error.message},400)
      return reply({users:data||[]})
    }
    if(action==='create'){
      if(!validLogin(loginName))return reply({error:'帳號需為 3–32 個小寫英文字母、數字、句點、底線或連字號'},400)
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email||'')))return reply({error:'請輸入有效的聯絡 Email'},400)
      if(!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(b.password||''))return reply({error:'密碼至少 8 字元，且需包含英文字母與數字'},400)
      const {data:loginOwner}=await admin.from('profiles').select('id').ilike('login_name',loginName).maybeSingle()
      if(loginOwner)return reply({error:'此登入帳號已被使用'},400)
      let {data,error}=await admin.auth.admin.createUser({email:b.email,password:b.password,email_confirm:true,app_metadata:{role:'sub_admin'}})
      let child=data?.user
      if(error){
        // 若前一次已建立 Auth 使用者但 profile 失敗，允許本次補寫 profile。
        const {data:authPage,error:listError}=await admin.auth.admin.listUsers({page:1,perPage:1000})
        if(listError)return reply({error:listError.message},400)
        child=(authPage.users||[]).find(x=>x.email?.toLowerCase()===String(b.email).toLowerCase())
        if(!child)return reply({error:error.message},400)
        const {error:passwordError}=await admin.auth.admin.updateUserById(child.id,{password:b.password,email_confirm:true})
        if(passwordError)return reply({error:passwordError.message},400)
      }
      const {error:profileError}=await admin.from('profiles').upsert({id:child!.id,email:b.email,login_name:loginName,display_name:b.display_name,role:'sub_admin',active:b.active!==false,must_change_password:!!b.must_change_password,permissions:b.permissions||{},updated_at:new Date().toISOString()})
      if(profileError)return reply({error:`帳號已建立，但管理資料寫入失敗：${profileError.message}`},400)
      await admin.from('audit_logs').insert({user_id:user.id,action:'新增子管理員',entity_type:'profile',entity_id:child!.id,description:loginName})
      return reply({ok:true})
    }
    const {data:target}=await admin.from('profiles').select('*').eq('id',b.user_id).single()
    if(!target)return reply({error:'找不到帳號'},404)
    if(target.role==='super_admin')return reply({error:'不可修改主管理員帳號'},403)
    if(action==='update'){
      if(!validLogin(loginName))return reply({error:'帳號需為 3–32 個小寫英文字母、數字、句點、底線或連字號'},400)
      const {data:loginOwner}=await admin.from('profiles').select('id').ilike('login_name',loginName).maybeSingle()
      if(loginOwner&&loginOwner.id!==b.user_id)return reply({error:'此登入帳號已被使用'},400)
      const {error}=await admin.from('profiles').update({login_name:loginName,display_name:b.display_name,active:b.active,permissions:b.permissions,updated_at:new Date().toISOString()}).eq('id',b.user_id)
      if(error)return reply({error:error.message},400)
    }else if(action==='reset_password'){
      if(!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(b.password||''))return reply({error:'密碼至少 8 字元，且需包含英文字母與數字'},400)
      const {error}=await admin.auth.admin.updateUserById(b.user_id,{password:b.password});if(error)return reply({error:error.message},400)
      await admin.from('profiles').update({must_change_password:!!b.must_change_password,updated_at:new Date().toISOString()}).eq('id',b.user_id)
    }else if(action==='delete'){
      const [{count:activityCount},{count:patientCount},{count:recordCount}]=await Promise.all([
        admin.from('activity_logs').select('*',{count:'exact',head:true}).eq('actor_id',b.user_id),
        admin.from('patients').select('*',{count:'exact',head:true}).or(`created_by.eq.${b.user_id},updated_by.eq.${b.user_id}`),
        admin.from('records').select('*',{count:'exact',head:true}).or(`created_by.eq.${b.user_id},updated_by.eq.${b.user_id}`),
      ])
      if((activityCount||0)>0||(patientCount||0)>0||(recordCount||0)>0)return reply({error:'此帳號已有個案、病歷或操作紀錄；為保留建立者資訊，請改為停用帳號'},400)
      // 舊版登入稽核不屬於工作資料，不應阻止未參與工作的帳號被刪除。
      const {error:auditDeleteError}=await admin.from('audit_logs').delete().eq('user_id',b.user_id)
      if(auditDeleteError)return reply({error:`清除舊登入稽核失敗：${auditDeleteError.message}`},400)
      const {error}=await admin.auth.admin.deleteUser(b.user_id);if(error)return reply({error:error.message},400)
    }else return reply({error:'不支援的操作'},400)
    await admin.from('audit_logs').insert({user_id:user.id,action:action==='update'?(b.active?'修改帳號權限':'停用帳號'):action==='reset_password'?'重設密碼':'刪除帳號',entity_type:'profile',entity_id:b.user_id,description:target.login_name||target.email})
    return reply({ok:true})
  }catch(e){return reply({error:e instanceof Error?e.message:'系統錯誤'},500)}
})
