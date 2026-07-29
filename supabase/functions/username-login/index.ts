import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
const normalizeLogin = (value: unknown) => String(value || '').trim().toLowerCase()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply({ error: '不支援的操作' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const body = await req.json()
    const loginName = normalizeLogin(body.login_name)
    const password = String(body.password || '')
    const genericError = { error: '帳號或密碼錯誤' }

    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(loginName) || !password) {
      return reply(genericError, 400)
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: profile } = await admin
      .from('profiles')
      .select('email,active')
      .ilike('login_name', loginName)
      .maybeSingle()

    if (!profile?.active || !profile.email) return reply(genericError, 400)

    const auth = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data, error } = await auth.auth.signInWithPassword({
      email: profile.email,
      password,
    })
    if (error || !data.session) return reply(genericError, 400)

    return reply({ session: data.session })
  } catch {
    return reply({ error: '登入服務暫時無法使用' }, 500)
  }
})

