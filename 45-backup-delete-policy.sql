-- Build 45：允許主管理員單獨刪除雲端備份。
-- 刪除 backup_snapshots 不會還原或重建 categories / patients。

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'backup_snapshots'
      and policyname = 'super deletes backups'
  ) then
    create policy "super deletes backups"
      on public.backup_snapshots
      for delete
      to authenticated
      using (public.is_super_admin());
  end if;
end
$$;

grant delete on table public.backup_snapshots to authenticated;
