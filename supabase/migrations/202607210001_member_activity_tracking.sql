-- Single-workspace member identity colors, actor attribution and activity history.
-- Existing rows remain nullable so legacy data is never attributed to the wrong member.

alter table public.profiles add column if not exists member_color text;
alter table public.patients add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.patients add column if not exists updated_by uuid references public.profiles(id) on delete set null;
alter table public.records add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.records add column if not exists updated_by uuid references public.profiles(id) on delete set null;

create or replace function private.default_member_color(p_user_id uuid) returns text
language sql immutable set search_path='' as $$
  select (array['#586A7A','#6F8575','#A4775B','#7D708D','#557F86','#9A765F','#6C7891','#87816D'])[
    1 + mod((('x'||substr(md5(p_user_id::text),1,8))::bit(32)::bigint),8)::integer
  ]
$$;
update public.profiles set member_color=private.default_member_color(id)
where member_color is null or member_color not in ('#586A7A','#6F8575','#A4775B','#7D708D','#557F86','#9A765F','#6C7891','#87816D');
alter table public.profiles alter column member_color set not null;
do $$begin if not exists(select 1 from pg_constraint where conname='profiles_member_color_palette_check') then
  alter table public.profiles add constraint profiles_member_color_palette_check
  check(member_color in ('#586A7A','#6F8575','#A4775B','#7D708D','#557F86','#9A765F','#6C7891','#87816D'));
end if; end$$;
create or replace function private.assign_member_color() returns trigger language plpgsql set search_path='' as $$
begin if new.member_color is null then new.member_color:=private.default_member_color(new.id); end if; return new; end$$;
drop trigger if exists profiles_assign_member_color on public.profiles;
create trigger profiles_assign_member_color before insert on public.profiles for each row execute function private.assign_member_color();

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action_type text not null check(action_type in (
    'patient_created','patient_updated','patient_deleted','record_created','record_updated','record_deleted',
    'category_created','category_updated','category_deleted','treatment_option_created','treatment_option_updated','treatment_option_deleted','member_updated')),
  target_type text not null,target_id text,patient_id uuid,
  metadata jsonb not null default '{}'::jsonb,change_summary text,created_at timestamptz not null default now()
);
create index if not exists activity_logs_actor_time_idx on public.activity_logs(actor_id,created_at desc);
create index if not exists activity_logs_created_at_idx on public.activity_logs(created_at desc);
create index if not exists activity_logs_action_type_idx on public.activity_logs(action_type);
create index if not exists activity_logs_patient_idx on public.activity_logs(patient_id,created_at desc);
create index if not exists activity_logs_target_type_idx on public.activity_logs(target_type,created_at desc);
create index if not exists patients_created_by_idx on public.patients(created_by);
create index if not exists patients_updated_by_idx on public.patients(updated_by);
create index if not exists records_created_by_idx on public.records(created_by);
create index if not exists records_updated_by_idx on public.records(updated_by);
alter table public.activity_logs enable row level security;
drop policy if exists activity_logs_read on public.activity_logs;
create policy activity_logs_read on public.activity_logs for select to authenticated using (
  actor_id=(select auth.uid()) or (select private.is_super_admin()) or (select private.has_permission('can_view_all_activity_logs'))
);
revoke all on public.activity_logs from anon,authenticated;
grant select on public.activity_logs to authenticated;

create or replace function public.log_activity(p_action_type text,p_target_type text,p_target_id text default null,p_patient_id uuid default null,p_metadata jsonb default '{}'::jsonb,p_change_summary text default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare new_id bigint; actor uuid:=(select auth.uid());
begin
  if actor is null or not private.is_active_user() then raise exception 'not authorized'; end if;
  if p_action_type not in ('patient_created','patient_updated','patient_deleted','record_created','record_updated','record_deleted','category_created','category_updated','category_deleted','treatment_option_created','treatment_option_updated','treatment_option_deleted','member_updated') then raise exception 'unsupported activity type'; end if;
  insert into public.activity_logs(actor_id,action_type,target_type,target_id,patient_id,metadata,change_summary)
  values(actor,p_action_type,p_target_type,p_target_id,p_patient_id,coalesce(p_metadata,'{}'::jsonb),left(p_change_summary,500)) returning id into new_id;
  return new_id;
end$$;
revoke all on function public.log_activity(text,text,text,uuid,jsonb,text) from public,anon,authenticated;

create or replace function public.log_member_update(p_user_id uuid,p_change_summary text default '更新成員資料與權限') returns bigint
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());
begin
  if actor is null or not private.is_active_user()
    or not ((select private.is_super_admin()) or (select private.has_permission('can_manage_member_colors')))
  then raise exception 'not authorized'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'member not found'; end if;
  return public.log_activity('member_updated','profile',p_user_id::text,null,jsonb_build_object('member_id',p_user_id),left(coalesce(p_change_summary,'更新成員資料與權限'),500));
end$$;
revoke all on function public.log_member_update(uuid,text) from public,anon;
grant execute on function public.log_member_update(uuid,text) to authenticated;

create or replace function private.stamp_last_actor() returns trigger language plpgsql set search_path='' as $$
begin new.created_by:=old.created_by; if auth.uid() is not null then new.updated_by:=auth.uid(); end if; return new; end$$;
drop trigger if exists patients_stamp_last_actor on public.patients;
create trigger patients_stamp_last_actor before update on public.patients for each row execute function private.stamp_last_actor();
drop trigger if exists records_stamp_last_actor on public.records;
create trigger records_stamp_last_actor before update on public.records for each row execute function private.stamp_last_actor();

create or replace function private.capture_core_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); row_doc jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; action_name text; patient uuid; summary text;
begin
  if actor is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_table_name='patients' then
    action_name:=case tg_op when 'INSERT' then 'patient_created' when 'UPDATE' then 'patient_updated' else 'patient_deleted' end; patient:=(row_doc->>'id')::uuid;
    summary:=case when tg_op='INSERT' then '新增個案' when tg_op='DELETE' then '刪除個案' else concat_ws('；',case when old.name is distinct from new.name then '姓名已更新' end,case when old.category_id is distinct from new.category_id then '分類已更新' end,case when old.patient_code is distinct from new.patient_code then '辨識代碼已更新' end) end;
  elsif tg_table_name='categories' then
    action_name:=case tg_op when 'INSERT' then 'category_created' when 'UPDATE' then 'category_updated' else 'category_deleted' end; summary:=case when tg_op='INSERT' then '新增分類：'||new.name when tg_op='DELETE' then '刪除分類：'||old.name else '分類設定已更新' end;
  elsif tg_table_name='treatment_options' then
    action_name:=case tg_op when 'INSERT' then 'treatment_option_created' when 'UPDATE' then 'treatment_option_updated' else 'treatment_option_deleted' end; summary:=case when tg_op='INSERT' then '新增處理方式：'||new.name when tg_op='DELETE' then '刪除處理方式：'||old.name else '處理方式設定已更新' end;
  elsif tg_table_name='records' and tg_op='DELETE' then action_name:='record_deleted';patient:=old.patient_id;summary:='刪除治療紀錄：'||old.visit_date::text;
  else if tg_op='DELETE' then return old; else return new; end if; end if;
  insert into public.activity_logs(actor_id,action_type,target_type,target_id,patient_id,metadata,change_summary)
  values(actor,action_name,tg_table_name,row_doc->>'id',patient,jsonb_strip_nulls(jsonb_build_object('name',row_doc->>'name','visit_date',row_doc->>'visit_date')),nullif(left(summary,500),''));
  if tg_op='DELETE' then return old; else return new; end if;
end$$;
drop trigger if exists patients_capture_activity on public.patients;
create trigger patients_capture_activity after insert or update or delete on public.patients for each row execute function private.capture_core_activity();
drop trigger if exists categories_capture_activity on public.categories;
create trigger categories_capture_activity after insert or update or delete on public.categories for each row execute function private.capture_core_activity();
drop trigger if exists treatment_options_capture_activity on public.treatment_options;
create trigger treatment_options_capture_activity after insert or update or delete on public.treatment_options for each row execute function private.capture_core_activity();
drop trigger if exists records_delete_capture_activity on public.records;
create trigger records_delete_capture_activity after delete on public.records for each row execute function private.capture_core_activity();

create or replace function public.get_member_directory() returns table(id uuid,display_name text,member_color text,role text)
language sql stable security definer set search_path='' as $$
  select p.id,coalesce(nullif(p.display_name,''),split_part(p.email,'@',1)),p.member_color,p.role from public.profiles p
  where auth.uid() is not null and p.active order by case when p.role='super_admin' then 0 else 1 end,p.display_name,p.email
$$;
revoke all on function public.get_member_directory() from public,anon;
grant execute on function public.get_member_directory() to authenticated;

create or replace function public.set_member_color(p_user_id uuid,p_color text default null,p_reset boolean default false) returns text
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());next_color text;member_name text;
begin
  if actor is null or not ((select private.is_super_admin()) or (select private.has_permission('can_manage_member_colors'))) then raise exception 'not authorized'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_user_id) then raise exception 'member not found'; end if;
  next_color:=case when p_reset then private.default_member_color(p_user_id) else upper(p_color) end;
  if next_color is null or next_color not in ('#586A7A','#6F8575','#A4775B','#7D708D','#557F86','#9A765F','#6C7891','#87816D') then raise exception 'unsupported member color'; end if;
  update public.profiles set member_color=next_color where id=p_user_id returning coalesce(nullif(display_name,''),split_part(email,'@',1)) into member_name;
  insert into public.activity_logs(actor_id,action_type,target_type,target_id,metadata,change_summary)
  values(actor,'member_updated','profile',p_user_id::text,jsonb_build_object('member_name',member_name),'更新成員識別色');return next_color;
end$$;
revoke all on function public.set_member_color(uuid,text,boolean) from public,anon;
grant execute on function public.set_member_color(uuid,text,boolean) to authenticated;

create or replace function public.get_activity_statistics(p_start timestamptz,p_end timestamptz,p_actor_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());can_team boolean;effective_actor uuid;
begin
  if actor is null then raise exception 'not authorized'; end if;
  can_team:=(select private.is_super_admin()) or (select private.has_permission('can_view_team_statistics'));
  if p_actor_id is not null and p_actor_id<>actor and not can_team then raise exception 'not authorized'; end if;
  effective_actor:=case when can_team then p_actor_id else actor end;
  return jsonb_build_object(
    'members',(select coalesce(jsonb_agg(to_jsonb(x) order by x.total_actions desc,x.display_name),'[]'::jsonb) from (
      select p.id,p.display_name,p.member_color,count(l.id)::int total_actions,count(*) filter(where l.action_type='patient_created')::int patients_created,count(*) filter(where l.action_type='record_created')::int records_created,count(*) filter(where l.action_type='record_updated')::int records_updated,count(*) filter(where l.action_type='record_deleted')::int records_deleted,count(distinct l.patient_id) filter(where l.patient_id is not null)::int active_patients,max(l.created_at) last_activity_at
      from public.profiles p left join public.activity_logs l on l.actor_id=p.id and l.created_at>=p_start and l.created_at<p_end where p.active and (effective_actor is null or p.id=effective_actor) group by p.id,p.display_name,p.member_color) x),
    'daily',(select coalesce(jsonb_agg(to_jsonb(x) order by x.activity_day,x.display_name),'[]'::jsonb) from (select date_trunc('day',l.created_at) as activity_day,p.id actor_id,p.display_name,p.member_color,count(*)::int total from public.activity_logs l join public.profiles p on p.id=l.actor_id where l.created_at>=p_start and l.created_at<p_end and (effective_actor is null or l.actor_id=effective_actor) group by date_trunc('day',l.created_at),p.id,p.display_name,p.member_color) x),
    'types',(select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc),'[]'::jsonb) from (select l.action_type,count(*)::int total from public.activity_logs l where l.created_at>=p_start and l.created_at<p_end and (effective_actor is null or l.actor_id=effective_actor) group by l.action_type) x));
end$$;
revoke all on function public.get_activity_statistics(timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.get_activity_statistics(timestamptz,timestamptz,uuid) to authenticated;

create or replace function public.save_structured_record(p_record_id uuid,p_patient_id uuid,p_visit_date date,p_notes text,p_body_parts jsonb,p_treatments jsonb default '[]'::jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=(select auth.uid());rid uuid;part jsonb;treatment jsonb;body_id uuid;body_option uuid;treatment_option uuid;part_index integer:=0;treatment_index integer;is_new boolean:=p_record_id is null;old_date date;old_notes text;old_summary text;new_summary text;summary text;
begin
  if actor is null or not private.is_active_user() then raise exception 'not authorized'; end if;
  if not exists(select 1 from public.patients p where p.id=p_patient_id) then raise exception 'patient not found'; end if;
  if is_new then insert into public.records(patient_id,visit_date,notes,created_by,updated_by) values(p_patient_id,p_visit_date,coalesce(p_notes,''),actor,actor) returning id into rid;
  else
    select r.visit_date,r.notes,(select string_agg(concat_ws('：',b.display_name,nullif((select string_agg(t.display_name,'、' order by t.sort_order) from public.record_body_part_treatments t where t.record_body_part_id=b.id),'')),'；' order by b.sort_order) from public.record_body_parts b where b.record_id=r.id) into old_date,old_notes,old_summary from public.records r where r.id=p_record_id and r.patient_id=p_patient_id;
    update public.records set visit_date=p_visit_date,notes=coalesce(p_notes,''),updated_by=actor where id=p_record_id and patient_id=p_patient_id returning id into rid;if rid is null then raise exception 'record not found'; end if;delete from public.record_body_parts where record_id=rid;
  end if;
  for part in select value from jsonb_array_elements(coalesce(p_body_parts,'[]'::jsonb)) loop body_option:=nullif(part->>'body_part_option_id','')::uuid;insert into public.record_body_parts(record_id,body_part_option_id,side,display_name,notes,clinical_data,sort_order) values(rid,body_option,coalesce(part->>'side','none'),coalesce(part->>'display_name','未命名部位'),coalesce(part->>'notes',''),coalesce(part->'clinical_data','{}'::jsonb),part_index) returning id into body_id;treatment_index:=0;for treatment in select value from jsonb_array_elements(coalesce(part->'treatments','[]'::jsonb)) loop treatment_option:=nullif(treatment->>'id','')::uuid;insert into public.record_body_part_treatments(record_body_part_id,treatment_option_id,display_name,sort_order) values(body_id,treatment_option,coalesce(treatment->>'display_name','未命名處理方式'),treatment_index);treatment_index:=treatment_index+1;end loop;part_index:=part_index+1;end loop;
  select string_agg(concat_ws('：',part_value->>'display_name',nullif((select string_agg(treatment_value->>'display_name','、') from jsonb_array_elements(coalesce(part_value->'treatments','[]'::jsonb)) as treatment_row(treatment_value)),'')),'；') into new_summary from jsonb_array_elements(coalesce(p_body_parts,'[]'::jsonb)) as part_row(part_value);
  summary:=case when is_new then '新增治療紀錄：'||p_visit_date::text||coalesce('｜'||nullif(new_summary,''),'') else concat_ws('；',case when old_date is distinct from p_visit_date then '日期：'||old_date::text||' → '||p_visit_date::text end,case when old_summary is distinct from new_summary then '部位與處理方式：'||coalesce(old_summary,'未填寫')||' → '||coalesce(new_summary,'未填寫') end,case when old_notes is distinct from coalesce(p_notes,'') then '整體備註已更新' end) end;
  perform public.log_activity(case when is_new then 'record_created' else 'record_updated' end,'record',rid::text,p_patient_id,jsonb_build_object('visit_date',p_visit_date,'body_count',jsonb_array_length(coalesce(p_body_parts,'[]'::jsonb))),nullif(summary,''));update public.patients set updated_by=actor where id=p_patient_id;return rid;
end$$;
