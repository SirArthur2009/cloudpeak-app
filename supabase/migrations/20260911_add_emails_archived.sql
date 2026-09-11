-- Add is_archived column to emails table if it doesn't exist
alter table public.emails add column if not exists is_archived boolean not null default false;

create index if not exists emails_is_archived_idx on public.emails (is_archived);
