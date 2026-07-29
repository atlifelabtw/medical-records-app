import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../supabase.js', import.meta.url), 'utf8')

test('activity log query supports dates, member, keyword, patient list and pagination', async () => {
  let requestedUrl = ''
  const context = {
    URLSearchParams,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async (url) => {
      requestedUrl = String(url)
      return { ok: true, json: async () => [] }
    },
    window: {},
  }
  vm.runInNewContext(source, context)

  await context.window.sb
    .from('activity_logs')
    .select('*')
    .gte('created_at', '2026-07-01T00:00:00.000Z')
    .lt('created_at', '2026-08-01T00:00:00.000Z')
    .eq('actor_id', 'actor-id')
    .in('patient_id', ['patient-a', 'patient-b'])
    .ilike('change_summary', '%右踝%')
    .order('created_at', { ascending: false })
    .range(30, 59)

  const url = new URL(requestedUrl)
  assert.equal(url.pathname, '/rest/v1/activity_logs')
  assert.equal(url.searchParams.getAll('created_at')[0], 'gte.2026-07-01T00:00:00.000Z')
  assert.equal(url.searchParams.getAll('created_at')[1], 'lt.2026-08-01T00:00:00.000Z')
  assert.equal(url.searchParams.get('actor_id'), 'eq.actor-id')
  assert.equal(url.searchParams.get('patient_id'), 'in.(patient-a,patient-b)')
  assert.equal(url.searchParams.get('change_summary'), 'ilike.%右踝%')
  assert.equal(url.searchParams.get('order'), 'created_at.desc')
  assert.equal(url.searchParams.get('offset'), '30')
  assert.equal(url.searchParams.get('limit'), '30')
})

