import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("個人版包含成員識別、操作紀錄與成員統計", async () => {
  const source = await readFile(new URL("../v2-app.js", import.meta.url), "utf8");
  assert.match(source, /const MEMBER_COLORS=\['#586A7A'/);
  assert.match(source, /const memberBadge=/);
  assert.match(source, /legacy='舊資料'/);
  assert.match(source, /function renderActivityLogs/);
  assert.match(source, /\.range\(activityState\.offset,activityState\.offset\+activityState\.pageSize-1\)/);
  assert.match(source, /function renderMemberStatistics/);
  assert.match(source, /can_view_all_activity_logs/);
  assert.match(source, /can_view_team_statistics/);
  assert.match(source, /can_manage_member_colors/);
});

test("個人版 migration 保留舊資料並限制資料存取", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/202607210001_member_activity_tracking.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /patients add column if not exists created_by/i);
  assert.match(sql, /records add column if not exists updated_by/i);
  assert.match(sql, /create table if not exists public\.activity_logs/i);
  assert.match(sql, /create policy activity_logs_read/i);
  assert.match(sql, /actor_id=\(select auth\.uid\(\)\)/i);
  assert.match(sql, /create or replace function public\.log_activity/i);
  assert.match(sql, /create or replace function public\.log_member_update/i);
  assert.match(sql, /revoke all on function public\.log_activity[\s\S]*authenticated/i);
  assert.match(sql, /perform public\.log_activity[\s\S]*record_created[\s\S]*record_updated/i);
});
