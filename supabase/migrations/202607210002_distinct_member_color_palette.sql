-- Increase hue separation while keeping the member palette professional and subdued.
create or replace function private.default_member_color(p_user_id uuid) returns text
language sql immutable set search_path='' as $$
  select (array['#3F6B8A','#4F7A5A','#A15C5C','#76558C','#3E7C78','#A66A3F','#5F6FA3','#8A7A3E'])[
    1 + mod((('x'||substr(md5(p_user_id::text),1,8))::bit(32)::bigint),8)::integer
  ]
$$;

alter table public.profiles drop constraint if exists profiles_member_color_palette_check;

update public.profiles
set member_color=case upper(member_color)
  when '#586A7A' then '#3F6B8A'
  when '#6F8575' then '#4F7A5A'
  when '#A4775B' then '#A15C5C'
  when '#7D708D' then '#76558C'
  when '#557F86' then '#3E7C78'
  when '#9A765F' then '#A66A3F'
  when '#6C7891' then '#5F6FA3'
  when '#87816D' then '#8A7A3E'
  when '#3F6B8A' then '#3F6B8A'
  when '#4F7A5A' then '#4F7A5A'
  when '#A15C5C' then '#A15C5C'
  when '#76558C' then '#76558C'
  when '#3E7C78' then '#3E7C78'
  when '#A66A3F' then '#A66A3F'
  when '#5F6FA3' then '#5F6FA3'
  when '#8A7A3E' then '#8A7A3E'
  else private.default_member_color(id)
end;

alter table public.profiles add constraint profiles_member_color_palette_check
  check(member_color in ('#3F6B8A','#4F7A5A','#A15C5C','#76558C','#3E7C78','#A66A3F','#5F6FA3','#8A7A3E'));

create or replace function private.next_member_color(p_exclude_user uuid default null) returns text
language sql stable set search_path='' as $$
  select c.color
  from unnest(array['#3F6B8A','#4F7A5A','#A15C5C','#76558C','#3E7C78','#A66A3F','#5F6FA3','#8A7A3E']) with ordinality c(color,sort_order)
  left join public.profiles p on p.member_color=c.color and p.id is distinct from p_exclude_user
  group by c.color,c.sort_order
  order by count(p.id),c.sort_order
  limit 1
$$;

with ranked as (
  select id,(array['#3F6B8A','#4F7A5A','#A15C5C','#76558C','#3E7C78','#A66A3F','#5F6FA3','#8A7A3E'])[
    1+mod((row_number() over(order by created_at,id)-1)::integer,8)
  ] as member_color
  from public.profiles
)
update public.profiles p set member_color=r.member_color from ranked r where r.id=p.id;

create or replace function private.assign_member_color() returns trigger language plpgsql set search_path='' as $$
begin if new.member_color is null then new.member_color:=private.next_member_color(new.id); end if; return new; end$$;

create or replace function public.set_member_color(p_user_id uuid,p_color text default null,p_reset boolean default false) returns text
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());next_color text;member_name text;
begin
  if actor is null or not ((select private.is_super_admin()) or (select private.has_permission('can_manage_member_colors'))) then raise exception 'not authorized'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_user_id) then raise exception 'member not found'; end if;
  next_color:=case when p_reset then private.next_member_color(p_user_id) else upper(p_color) end;
  if next_color is null or next_color not in ('#3F6B8A','#4F7A5A','#A15C5C','#76558C','#3E7C78','#A66A3F','#5F6FA3','#8A7A3E') then raise exception 'unsupported member color'; end if;
  update public.profiles set member_color=next_color where id=p_user_id returning coalesce(nullif(display_name,''),split_part(email,'@',1)) into member_name;
  insert into public.activity_logs(actor_id,action_type,target_type,target_id,metadata,change_summary)
  values(actor,'member_updated','profile',p_user_id::text,jsonb_build_object('member_name',member_name),'更新成員識別色');return next_color;
end$$;
revoke all on function public.set_member_color(uuid,text,boolean) from public,anon;
grant execute on function public.set_member_color(uuid,text,boolean) to authenticated;
