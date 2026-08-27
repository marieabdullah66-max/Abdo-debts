-- V10 — in-app notifications for new invoices and payments.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('invoice_created','payment_created')),
  branch_id uuid not null references public.branches(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  entity_id uuid not null,
  amount numeric(14,2) not null check (amount >= 0),
  invoice_number text,
  supplier_name text not null,
  branch_name text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now()
);
create index if not exists notifications_created_idx on public.notifications(created_at desc);
create index if not exists notifications_branch_idx on public.notifications(branch_id, created_at desc);
create index if not exists notifications_event_idx on public.notifications(event_type, created_at desc);

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, profile_id)
);
create index if not exists notification_reads_profile_idx on public.notification_reads(profile_id, read_at desc);

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

revoke all on table public.notifications, public.notification_reads from anon, authenticated;
