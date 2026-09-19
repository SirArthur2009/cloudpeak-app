update public.applications a set status = 'reviewed'
where (a.status is null or lower(a.status) = 'new')
  and exists (select 1 from public.waitlist w where lower(trim(w.email)) = lower(trim(a.email)));

create function public.review_waitlisted_application() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is null or lower(new.status) = 'new' then
    if exists (select 1 from public.waitlist w where lower(trim(w.email)) = lower(trim(new.email))) then
      new.status := 'reviewed';
    end if;
  end if;
  return new;
end $$;
create trigger review_waitlisted_application_before_write
before insert or update of email, status on public.applications
for each row execute function public.review_waitlisted_application();
revoke all on function public.review_waitlisted_application() from public, anon, authenticated;

create function public.review_applications_when_waitlisted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.applications a set status = 'reviewed'
  where lower(trim(a.email)) = lower(trim(new.email))
    and (a.status is null or lower(a.status) = 'new');
  return new;
end $$;
create trigger review_applications_after_waitlist_write
after insert or update of email on public.waitlist
for each row execute function public.review_applications_when_waitlisted();
revoke all on function public.review_applications_when_waitlisted() from public, anon, authenticated;
