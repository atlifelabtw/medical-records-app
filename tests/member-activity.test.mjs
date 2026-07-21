import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("個人版包含成員識別、操作紀錄與成員統計", async () => {
  const source = await readFile(new URL("../v2-app.js", import.meta.url), "utf8");
  assert.match(source, /const MEMBER_COLORS=\['#3F6B8A'/);
  assert.match(source, /const memberBadge=/);
  assert.match(source, /legacy='舊資料'/);
  assert.match(source, /function renderActivityLogs/);
  assert.match(source, /\.range\(activityState\.offset,activityState\.offset\+activityState\.pageSize-1\)/);
  assert.match(source, /function renderMemberStatistics/);
  assert.match(source, /can_view_all_activity_logs/);
  assert.match(source, /can_view_team_statistics/);
  assert.match(source, /can_manage_member_colors/);
});

test("成員識別色使用差異明顯的新色盤", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/202607210002_distinct_member_color_palette.sql", import.meta.url),
    "utf8",
  );
  for (const color of ["#3F6B8A", "#4F7A5A", "#A15C5C", "#76558C", "#3E7C78", "#A66A3F", "#5F6FA3", "#8A7A3E"]) {
    assert.match(sql, new RegExp(color));
  }
  assert.match(sql, /drop constraint if exists profiles_member_color_palette_check/i);
  assert.match(sql, /create or replace function private\.next_member_color/i);
  assert.match(sql, /row_number\(\) over\(order by created_at,id\)/i);
  assert.match(sql, /create or replace function public\.set_member_color/i);
});

test("個人版 migration 保留舊資料並限制資料存取", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/202607210001_member_activity_tracking.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /patients add column if not exists created_by/i);
  assert.match(sql, /records add column if not exists updated_by/i);
  assert.match(sql, /create schema if not exists private/i);
  assert.match(sql, /create or replace function private\.is_active_user/i);
  assert.match(sql, /create or replace function private\.is_super_admin/i);
  assert.match(sql, /create or replace function private\.has_permission/i);
  assert.match(sql, /create table if not exists public\.activity_logs/i);
  assert.match(sql, /create policy activity_logs_read/i);
  assert.match(sql, /actor_id=\(select auth\.uid\(\)\)/i);
  assert.match(sql, /create or replace function public\.log_activity/i);
  assert.match(sql, /create or replace function public\.log_member_update/i);
  assert.match(sql, /revoke all on function public\.log_activity[\s\S]*authenticated/i);
  assert.match(sql, /perform public\.log_activity[\s\S]*record_created[\s\S]*record_updated/i);
});
