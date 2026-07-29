import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const client = fs.readFileSync(new URL('../supabase.js', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../v2-app.js', import.meta.url), 'utf8')
const migration = fs.readFileSync(
  new URL('../supabase/migrations/202607290001_username_password_login.sql', import.meta.url),
  'utf8',
)
const loginFunction = fs.readFileSync(
  new URL('../supabase/functions/username-login/index.ts', import.meta.url),
  'utf8',
)
const adminFunction = fs.readFileSync(
  new URL('../supabase/functions/admin-users/index.ts', import.meta.url),
  'utf8',
)

test('login form accepts an account name instead of requiring an email', () => {
  assert.match(html, /name="login_name" type="text"/)
  assert.doesNotMatch(html, /name="email" type="email" required autocomplete="username"/)
  assert.match(html, /autocomplete="username"/)
})

test('client stores the session returned by username-login', () => {
  assert.match(client, /signInWithUsername/)
  assert.match(client, /invokeFunction\('username-login',values\)/)
  assert.match(client, /localStorage\.setItem\(STORE,JSON\.stringify\(x\.data\.session\)\)/)
})

test('legacy email login remains available as a recovery path', () => {
  assert.match(app, /login\.includes\('@'\)\?await sb\.auth\.signInWithPassword/)
  assert.match(app, /await sb\.auth\.signInWithUsername/)
})

test('migration adds a normalized unique login name without changing auth passwords', () => {
  assert.match(migration, /add column if not exists login_name text/)
  assert.match(migration, /profiles_login_name_unique/)
  assert.match(migration, /lower\(login_name\)/)
  const executableSql = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--') && !line.includes('comment on column'))
    .join('\n')
  assert.doesNotMatch(executableSql, /auth\.users|encrypted_password|update\s+[^;]*password/i)
  assert.doesNotMatch(migration, /delete from|truncate/i)
})

test('username login resolves only active profiles and returns generic errors', () => {
  assert.match(loginFunction, /\.select\('email,active'\)/)
  assert.match(loginFunction, /if \(!profile\?\.active \|\| !profile\.email\)/)
  assert.match(loginFunction, /帳號或密碼錯誤/)
  assert.doesNotMatch(loginFunction, /console\.(log|error)/)
})

test('account management validates and stores login names', () => {
  assert.match(adminFunction, /validLogin/)
  assert.match(adminFunction, /login_name:loginName/)
  assert.match(adminFunction, /此登入帳號已被使用/)
  assert.match(app, /name="login_name"/)
})
