-- Stores inbound emails received via the Resend inbound webhook and outbound
-- replies sent by admins from the Settings > Email tab.
create table if not exists public.emails (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null default gen_random_uuid(),
  direction text not null check (direction in ('inbound', 'outbound')),
  resend_id text,
  from_email text not null,
  to_email text not null,
  subject text,
  text_body text,
  html_body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists emails_thread_id_idx on public.emails (thread_id);
create index if not exists emails_created_at_idx on public.emails (created_at desc);

alter table public.emails enable row level security;

-- Only admins can view or manage emails. The edge functions use the
-- service role key and therefore bypass RLS when inserting/updating.
drop policy if exists "Admins can read emails" on public.emails;
create policy "Admins can read emails"
  on public.emails for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can update emails" on public.emails;
create policy "Admins can update emails"
  on public.emails for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
