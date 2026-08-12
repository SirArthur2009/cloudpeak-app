-- Adds litter-specific waitlist support expected by the app.
-- Safe to run multiple times.

begin;

-- 1) Add column if missing, matching public.litters.id data type.
do $$
declare
  litter_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
  into litter_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'litters'
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if litter_id_type is null then
    raise exception 'Could not determine type of public.litters.id';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'waitlist'
      and column_name = 'litter_id'
  ) then
    execute format('alter table public.waitlist add column litter_id %s', litter_id_type);
  end if;
end $$;

-- 2) Backfill existing rows to the first litter so they remain visible.
--    If no litter exists yet, rows stay null and can be assigned later.
with first_litter as (
  select id
  from public.litters
  order by created_at asc nulls last, id asc
  limit 1
)
update public.waitlist w
set litter_id = f.id
from first_litter f
where w.litter_id is null;

-- 3) Add FK if it does not already exist.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'waitlist_litter_id_fkey'
      and conrelid = 'public.waitlist'::regclass
  ) then
    alter table public.waitlist
      add constraint waitlist_litter_id_fkey
      foreign key (litter_id)
      references public.litters(id)
      on update cascade
      on delete set null;
  end if;
end $$;

-- 4) Helpful indexes for per-litter queries.
create index if not exists idx_waitlist_litter_id
  on public.waitlist(litter_id);

create index if not exists idx_waitlist_litter_position
  on public.waitlist(litter_id, position);

commit;
