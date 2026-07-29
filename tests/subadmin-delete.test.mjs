import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const adminFunction = fs.readFileSync(
  new URL('../supabase/functions/admin-users/index.ts', import.meta.url),
  'utf8',
)
const app = fs.readFileSync(new URL('../v2-app.js', import.meta.url), 'utf8')

test('a login-only subadmin can be deleted', () => {
  assert.doesNotMatch(adminFunction, /target\.last_login_at/)
  assert.doesNotMatch(adminFunction, /此帳號已有登入或操作紀錄，只能停用/)
  assert.match(adminFunction, /舊版登入稽核不屬於工作資料/)
  assert.match(adminFunction, /\.from\('audit_logs'\)\.delete\(\)\.eq\('user_id',b\.user_id\)/)
  assert.match(adminFunction, /admin\.auth\.admin\.deleteUser\(b\.user_id\)/)
})

test('subadmins referenced by work data remain protected', () => {
  assert.match(adminFunction, /\.from\('activity_logs'\)/)
  assert.match(adminFunction, /\.from\('patients'\)/)
  assert.match(adminFunction, /\.from\('records'\)/)
  assert.match(adminFunction, /為保留建立者資訊，請改為停用帳號/)
})

test('the UI warns that permanent deletion cannot be undone', () => {
  assert.match(app, /確定要永久刪除此子管理員/)
  assert.match(app, /帳號與舊登入稽核將移除，且無法復原/)
})

