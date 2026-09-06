-- Allow admins to delete emails from the emails table
drop policy if exists "Admins can delete emails" on public.emails;
create policy "Admins can delete emails"
  on public.emails for delete
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
