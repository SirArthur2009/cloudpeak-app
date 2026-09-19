-- Private admin file library. Object names are UUIDs, independent of display names.
insert into storage.buckets (id, name, public, file_size_limit)
values ('admin-files', 'admin-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

create table public.admin_folders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.admin_folders(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 150),
  created_at timestamptz not null default now(),
  unique (parent_id, name)
);
create unique index admin_folders_root_name_key on public.admin_folders(name) where parent_id is null;

create table public.admin_files (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.admin_folders(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 255),
  storage_path text not null unique,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  content_type text,
  created_at timestamptz not null default now()
);
create index admin_files_folder_idx on public.admin_files(folder_id);
create index admin_folders_parent_idx on public.admin_folders(parent_id);

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 150),
  subject text not null check (length(trim(subject)) between 1 and 300),
  body text not null check (length(trim(body)) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_folders enable row level security;
alter table public.admin_files enable row level security;
alter table public.email_templates enable row level security;

create policy "Admins manage folders" on public.admin_folders for all to authenticated
  using (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));
create policy "Admins manage files" on public.admin_files for all to authenticated
  using (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));
create policy "Admins manage email templates" on public.email_templates for all to authenticated
  using (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));

create policy "Admins access private files" on storage.objects for all to authenticated
  using (bucket_id = 'admin-files' and exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'))
  with check (bucket_id = 'admin-files' and exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));
