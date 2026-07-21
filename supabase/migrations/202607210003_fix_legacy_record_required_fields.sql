-- Keep the legacy required summary columns populated while structured body parts remain the source of truth.
-- Older personal databases predate the editable structured-record metadata columns.
-- Add them without touching existing rows so the current editor works across upgrades.
alter table public.record_body_parts
  add column if not exists notes text not null default '',
  add column if not exists clinical_data jsonb not null default '{}'::jsonb,
  add column if not exists sort_order integer not null default 0;

alter table public.record_body_part_treatments
  add column if not exists sort_order integer not null default 0;

create or replace function public.save_structured_record(p_record_id uuid,p_patient_id uuid,p_visit_date date,p_notes text,p_body_parts jsonb,p_treatments jsonb default '[]'::jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare
  actor uuid:=(select auth.uid());rid uuid;part jsonb;treatment jsonb;body_id uuid;body_option uuid;treatment_option uuid;
  part_index integer:=0;treatment_index integer;is_new boolean:=p_record_id is null;
  old_date date;old_notes text;old_summary text;new_summary text;summary text;legacy_body text;legacy_treatment text;
begin
  if actor is null or not private.is_active_user() then raise exception 'not authorized'; end if;
  if not exists(select 1 from public.patients p where p.id=p_patient_id) then raise exception 'patient not found'; end if;

  select coalesce(string_agg(distinct nullif(part_value->>'display_name',''),'、'),'未填寫')
  into legacy_body from jsonb_array_elements(coalesce(p_body_parts,'[]'::jsonb)) as part_row(part_value);
  select coalesce(string_agg(distinct nullif(treatment_value->>'display_name',''),'、'),'未填寫')
  into legacy_treatment
  from jsonb_array_elements(coalesce(p_body_parts,'[]'::jsonb)) as part_row(part_value)
  cross join lateral jsonb_array_elements(coalesce(part_value->'treatments','[]'::jsonb)) as treatment_row(treatment_value);

  if is_new then
    insert into public.records(patient_id,visit_date,body_part,treatment,notes,created_by,updated_by)
    values(p_patient_id,p_visit_date,legacy_body,legacy_treatment,coalesce(p_notes,''),actor,actor) returning id into rid;
  else
    select r.visit_date,r.notes,
      (select string_agg(concat_ws('：',b.display_name,nullif((select string_agg(t.display_name,'、' order by t.sort_order) from public.record_body_part_treatments t where t.record_body_part_id=b.id),'')),'；' order by b.sort_order)
       from public.record_body_parts b where b.record_id=r.id)
    into old_date,old_notes,old_summary from public.records r where r.id=p_record_id and r.patient_id=p_patient_id;
    update public.records set visit_date=p_visit_date,body_part=legacy_body,treatment=legacy_treatment,notes=coalesce(p_notes,''),updated_by=actor
    where id=p_record_id and patient_id=p_patient_id returning id into rid;
    if rid is null then raise exception 'record not found'; end if;
    delete from public.record_body_parts where record_id=rid;
  end if;

  for part in select value from jsonb_array_elements(coalesce(p_body_parts,'[]'::jsonb)) loop
    body_option:=nullif(part->>'body_part_option_id','')::uuid;
    insert into public.record_body_parts(record_id,body_part_option_id,side,display_name,notes,clinical_data,sort_order)
    values(rid,body_option,coalesce(part->>'side','none'),coalesce(part->>'display_name','未命名部位'),coalesce(part->>'notes',''),coalesce(part->'clinical_data','{}'::jsonb),part_index) returning id into body_id;
    treatment_index:=0;
    for treatment in select value from jsonb_array_elements(coalesce(part->'treatments','[]'::jsonb)) loop
      treatment_option:=nullif(treatment->>'id','')::uuid;
      insert into public.record_body_part_treatments(record_body_part_id,treatment_option_id,display_name,sort_order)
      values(body_id,treatment_option,coalesce(treatment->>'display_name','未命名處理方式'),treatment_index);
      treatment_index:=treatment_index+1;
    end loop;
    part_index:=part_index+1;
  end loop;

  select string_agg(concat_ws('：',part_value->>'display_name',nullif((select string_agg(treatment_value->>'display_name','、') from jsonb_array_elements(coalesce(part_value->'treatments','[]'::jsonb)) as treatment_row(treatment_value)),'')),'；')
  into new_summary from jsonb_array_elements(coalesce(p_body_parts,'[]'::jsonb)) as part_row(part_value);
  summary:=case when is_new then '新增治療紀錄：'||p_visit_date::text||coalesce('｜'||nullif(new_summary,''),'')
    else concat_ws('；',case when old_date is distinct from p_visit_date then '日期：'||old_date::text||' → '||p_visit_date::text end,
      case when old_summary is distinct from new_summary then '部位與處理方式：'||coalesce(old_summary,'未填寫')||' → '||coalesce(new_summary,'未填寫') end,
      case when old_notes is distinct from coalesce(p_notes,'') then '整體備註已更新' end) end;
  perform public.log_activity(case when is_new then 'record_created' else 'record_updated' end,'record',rid::text,p_patient_id,
    jsonb_build_object('visit_date',p_visit_date,'body_count',jsonb_array_length(coalesce(p_body_parts,'[]'::jsonb))),nullif(summary,''));
  update public.patients set updated_by=actor where id=p_patient_id;
  return rid;
end$$;
