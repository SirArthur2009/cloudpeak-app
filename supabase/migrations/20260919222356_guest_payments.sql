create table public.guest_payments (
  id uuid primary key default gen_random_uuid(),
  waitlist_id bigint not null references public.waitlist(id) on delete cascade,
  payment_type text not null check (payment_type in ('pre_litter_deposit', 'post_litter_deposit', 'born_litter_deposit', 'final_payment', 'full_payment', 'other')),
  amount numeric(10,2) not null check (amount > 0),
  paid_at date not null default current_date,
  note text not null default '',
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index guest_payments_waitlist_id_idx on public.guest_payments(waitlist_id);
alter table public.guest_payments enable row level security;
grant select, insert, delete on public.guest_payments to authenticated;

create policy "Admins read guest payments" on public.guest_payments for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create policy "Admins record guest payments" on public.guest_payments for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin') and recorded_by = (select auth.uid()));
create policy "Admins remove guest payments" on public.guest_payments for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
