-- Explorer images linked to public pages live in an existing public photo bucket.
-- The explorer retains the metadata row and points at that same object.
alter table public.admin_files
  add column storage_bucket text not null default 'admin-files';
