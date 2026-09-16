-- Abdo Debts v1 - fresh Supabase project schema
create extension if not exists pgcrypto;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text not null,
  role text not null default 'finance' check (role in ('admin','finance','viewer')),
  active boolean not null default true,
  permissions jsonb not null default '{}'::jsonb,
  all_branches boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.profile_branches (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  primary key (profile_id, branch_id)
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists suppliers_name_idx on public.suppliers using btree (lower(name));

create table if not exists public.supplier_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists supplier_categories_name_idx on public.supplier_categories using btree (lower(name));

create table if not exists public.supplier_category_links (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  category_id uuid not null references public.supplier_categories(id) on delete restrict,
  primary key (supplier_id, category_id)
);
create index if not exists supplier_category_links_category_idx on public.supplier_category_links(category_id);


create table if not exists public.item_catalog (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,
  item_name text not null,
  package_form text,
  units_per_box integer not null check (units_per_box > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists item_catalog_name_idx on public.item_catalog using btree (lower(item_name));
create index if not exists item_catalog_code_idx on public.item_catalog(item_code);


-- V18 — Monthly item movement analysis.
create table if not exists public.item_name_aliases (
  id uuid primary key default gen_random_uuid(),
  report_name text not null,
  report_name_norm text not null unique,
  item_id uuid not null references public.item_catalog(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists item_name_aliases_item_idx on public.item_name_aliases(item_id);

create table if not exists public.item_movement_reports (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  source_name text,
  source_filename text,
  period_start date not null,
  period_end date not null,
  days_count integer not null check (days_count > 0),
  transaction_count integer not null default 0 check (transaction_count >= 0),
  unique_item_count integer not null default 0 check (unique_item_count >= 0),
  unresolved_count integer not null default 0 check (unresolved_count >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(branch_id, period_start, period_end)
);
create index if not exists item_movement_reports_branch_period_idx on public.item_movement_reports(branch_id, period_end desc);

create table if not exists public.item_movement_rows (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.item_movement_reports(id) on delete cascade,
  report_name text not null,
  report_name_norm text not null,
  item_id uuid references public.item_catalog(id) on delete set null,
  boxes_sold numeric(16,6) not null default 0 check (boxes_sold >= 0),
  loose_sold numeric(16,6) not null default 0 check (loose_sold >= 0),
  units_per_box integer check (units_per_box > 0),
  equivalent_boxes numeric(18,6),
  daily_rate numeric(18,6),
  matched_by text not null default 'unmatched' check (matched_by in ('exact','alias','manual','unmatched')),
  created_at timestamptz not null default now(),
  unique(report_id, report_name_norm)
);
create index if not exists item_movement_rows_report_idx on public.item_movement_rows(report_id);
create index if not exists item_movement_rows_item_idx on public.item_movement_rows(item_id);
create index if not exists item_movement_rows_unmatched_idx on public.item_movement_rows(report_id, matched_by);

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

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  invoice_number text not null,
  amount numeric(14,2) not null check (amount > 0),
  invoice_date date not null,
  due_date date,
  notes text,
  pdf_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_supplier_idx on public.invoices(supplier_id);
create index if not exists invoices_branch_idx on public.invoices(branch_id);
create index if not exists invoices_date_idx on public.invoices(invoice_date desc);
create index if not exists invoices_number_idx on public.invoices(invoice_number);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_date date not null,
  method text not null check (method in ('cash','bank')),
  bank_name text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_bank_name_check check ((method = 'cash' and bank_name is null) or (method = 'bank' and nullif(trim(bank_name),'') is not null))
);
create index if not exists payments_supplier_idx on public.payments(supplier_id);
create index if not exists payments_branch_idx on public.payments(branch_id);
create index if not exists payments_date_idx on public.payments(payment_date desc);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  unique(payment_id, invoice_id)
);
create index if not exists payment_allocations_invoice_idx on public.payment_allocations(invoice_id);
create index if not exists payment_allocations_payment_idx on public.payment_allocations(payment_id);

create table if not exists public.payment_plans (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  planned_amount numeric(14,2) not null check (planned_amount > 0),
  planned_date date not null,
  notes text,
  status text not null default 'planned' check (status in ('planned','postponed','completed','cancelled')),
  postpone_count integer not null default 0 check (postpone_count >= 0),
  last_postpone_reason text,
  completed_payment_id uuid references public.payments(id) on delete set null,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_plans_date_idx on public.payment_plans(planned_date, status);
create index if not exists payment_plans_supplier_idx on public.payment_plans(supplier_id, planned_date);
create index if not exists payment_plans_branch_idx on public.payment_plans(branch_id, planned_date);
create index if not exists payment_plans_status_idx on public.payment_plans(status, planned_date);

create or replace view public.invoice_balances as
select
  i.id, i.supplier_id, i.branch_id, s.name as supplier_name, b.name as branch_name,
  i.invoice_number, i.amount, i.invoice_date, i.due_date,
  i.notes, i.pdf_path, i.created_by, i.created_at, i.updated_at,
  coalesce(sum(pa.amount), 0)::numeric(14,2) as paid_amount,
  (i.amount - coalesce(sum(pa.amount), 0))::numeric(14,2) as balance,
  case
    when coalesce(sum(pa.amount),0) = 0 then 'unpaid'
    when coalesce(sum(pa.amount),0) < i.amount then 'partial'
    else 'paid'
  end as status
from public.invoices i
join public.suppliers s on s.id = i.supplier_id
join public.branches b on b.id = i.branch_id
left join public.payment_allocations pa on pa.invoice_id = i.id
group by i.id, s.name, b.name;

-- Atomic create: one payment can be distributed manually over several invoices,
-- but every selected invoice must belong to the same supplier and branch.
create or replace function public.create_payment_with_allocations(
  p_supplier_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_method text,
  p_bank_name text,
  p_notes text,
  p_created_by uuid,
  p_allocations jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_item jsonb;
  v_invoice_id uuid;
  v_alloc numeric;
  v_invoice public.invoices%rowtype;
  v_paid numeric;
  v_sum numeric := 0;
begin
  if p_method not in ('cash','bank') then raise exception 'Invalid payment method'; end if;
  if p_method = 'bank' and nullif(trim(coalesce(p_bank_name,'')),'') is null then raise exception 'Bank name required'; end if;
  if jsonb_array_length(p_allocations) = 0 then raise exception 'Allocations required'; end if;

  for v_item in select * from jsonb_array_elements(p_allocations) loop
    v_invoice_id := (v_item->>'invoice_id')::uuid;
    v_alloc := (v_item->>'amount')::numeric;
    if v_alloc <= 0 then raise exception 'Invalid allocation'; end if;
    select * into v_invoice from public.invoices where id = v_invoice_id for update;
    if not found then raise exception 'Invoice not found'; end if;
    if v_invoice.supplier_id <> p_supplier_id or v_invoice.branch_id <> p_branch_id then
      raise exception 'Invoices must match supplier and branch';
    end if;
    select coalesce(sum(amount),0) into v_paid from public.payment_allocations where invoice_id = v_invoice_id;
    if v_alloc > (v_invoice.amount - v_paid) then raise exception 'Allocation exceeds invoice balance'; end if;
    v_sum := v_sum + v_alloc;
  end loop;
  if round(v_sum,2) <> round(p_amount,2) then raise exception 'Allocations must equal payment amount'; end if;

  insert into public.payments(supplier_id,branch_id,amount,payment_date,method,bank_name,notes,created_by)
  values(p_supplier_id,p_branch_id,p_amount,p_payment_date,p_method,case when p_method='bank' then nullif(trim(p_bank_name),'') else null end,p_notes,p_created_by)
  returning id into v_payment_id;

  for v_item in select * from jsonb_array_elements(p_allocations) loop
    insert into public.payment_allocations(payment_id,invoice_id,amount)
    values(v_payment_id,(v_item->>'invoice_id')::uuid,(v_item->>'amount')::numeric);
  end loop;
  return v_payment_id;
end;
$$;

create or replace function public.update_payment_with_allocations(
  p_payment_id uuid,
  p_supplier_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_method text,
  p_bank_name text,
  p_notes text,
  p_allocations jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_invoice_id uuid;
  v_alloc numeric;
  v_invoice public.invoices%rowtype;
  v_paid_other numeric;
  v_sum numeric := 0;
begin
  perform 1 from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p_method not in ('cash','bank') then raise exception 'Invalid payment method'; end if;
  if p_method = 'bank' and nullif(trim(coalesce(p_bank_name,'')),'') is null then raise exception 'Bank name required'; end if;
  if jsonb_array_length(p_allocations) = 0 then raise exception 'Allocations required'; end if;

  for v_item in select * from jsonb_array_elements(p_allocations) loop
    v_invoice_id := (v_item->>'invoice_id')::uuid;
    v_alloc := (v_item->>'amount')::numeric;
    if v_alloc <= 0 then raise exception 'Invalid allocation'; end if;
    select * into v_invoice from public.invoices where id = v_invoice_id for update;
    if not found then raise exception 'Invoice not found'; end if;
    if v_invoice.supplier_id <> p_supplier_id or v_invoice.branch_id <> p_branch_id then raise exception 'Invoices must match supplier and branch'; end if;
    select coalesce(sum(amount),0) into v_paid_other from public.payment_allocations where invoice_id = v_invoice_id and payment_id <> p_payment_id;
    if v_alloc > (v_invoice.amount - v_paid_other) then raise exception 'Allocation exceeds invoice balance'; end if;
    v_sum := v_sum + v_alloc;
  end loop;
  if round(v_sum,2) <> round(p_amount,2) then raise exception 'Allocations must equal payment amount'; end if;

  update public.payments set supplier_id=p_supplier_id, branch_id=p_branch_id, amount=p_amount,
    payment_date=p_payment_date, method=p_method,
    bank_name=case when p_method='bank' then nullif(trim(p_bank_name),'') else null end,
    notes=p_notes, updated_at=now()
  where id=p_payment_id;

  delete from public.payment_allocations where payment_id=p_payment_id;
  for v_item in select * from jsonb_array_elements(p_allocations) loop
    insert into public.payment_allocations(payment_id,invoice_id,amount)
    values(p_payment_id,(v_item->>'invoice_id')::uuid,(v_item->>'amount')::numeric);
  end loop;
end;
$$;

-- Frontend talks only to FastAPI. Keep direct browser database access locked down.
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_branches enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_categories enable row level security;
alter table public.supplier_category_links enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_plans enable row level security;
alter table public.item_catalog enable row level security;
alter table public.item_name_aliases enable row level security;
alter table public.item_movement_reports enable row level security;
alter table public.item_movement_rows enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

-- Private bucket for the original invoice PDF attachment (max enforced again in API).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-pdfs', 'invoice-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update set public=false, file_size_limit=10485760, allowed_mime_types=array['application/pdf'];

-- Do not expose financial data directly through the public Supabase API roles.
revoke all on table public.branches, public.profiles, public.profile_branches, public.suppliers,
  public.supplier_categories, public.supplier_category_links, public.invoices, public.payments,
  public.payment_allocations, public.payment_plans, public.item_catalog, public.item_name_aliases, public.item_movement_reports, public.item_movement_rows, public.notifications, public.notification_reads from anon, authenticated;
revoke all on table public.invoice_balances from anon, authenticated;
revoke execute on function public.create_payment_with_allocations(uuid,uuid,numeric,date,text,text,text,uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.update_payment_with_allocations(uuid,uuid,uuid,numeric,date,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_payment_with_allocations(uuid,uuid,numeric,date,text,text,text,uuid,jsonb) to service_role;
grant execute on function public.update_payment_with_allocations(uuid,uuid,uuid,numeric,date,text,text,text,jsonb) to service_role;

-- V11 — Prevent duplicate invoice numbers for the same supplier.
create or replace function public.prevent_duplicate_supplier_invoice()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_new_number text;
  v_old_number text;
begin
  v_new_number := lower(regexp_replace(btrim(new.invoice_number), '\s+', ' ', 'g'));
  if tg_op = 'UPDATE' then
    v_old_number := lower(regexp_replace(btrim(old.invoice_number), '\s+', ' ', 'g'));
    if new.supplier_id = old.supplier_id and v_new_number = v_old_number then
      return new;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.supplier_id::text || '|' || v_new_number, 0));
  if exists (
    select 1 from public.invoices i
    where i.supplier_id = new.supplier_id
      and lower(regexp_replace(btrim(i.invoice_number), '\s+', ' ', 'g')) = v_new_number
      and i.id is distinct from new.id
  ) then
    raise exception using errcode = '23505', message = 'رقم الفاتورة موجود مسبقًا لهذا المورد ولا يمكن تكراره';
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_prevent_duplicate_number on public.invoices;
create trigger invoices_prevent_duplicate_number
before insert or update of supplier_id, invoice_number on public.invoices
for each row execute function public.prevent_duplicate_supplier_invoice();

-- V19 — Replace the item catalog without deleting historical movement reports.
create or replace function public.reset_item_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items integer := 0;
  v_aliases integer := 0;
  v_reports integer := 0;
begin
  select count(*) into v_items from public.item_catalog;
  select count(*) into v_aliases from public.item_name_aliases;
  select count(*) into v_reports from public.item_movement_reports;
  delete from public.item_name_aliases;
  delete from public.item_catalog;
  update public.item_movement_rows mr
     set item_id = null,
         units_per_box = null,
         equivalent_boxes = case when coalesce(mr.loose_sold, 0) = 0 then mr.boxes_sold else null end,
         daily_rate = case when coalesce(mr.loose_sold, 0) = 0 and r.days_count > 0 then round((mr.boxes_sold / r.days_count)::numeric, 6) else null end,
         matched_by = 'unmatched'
    from public.item_movement_reports r
   where mr.report_id = r.id;
  update public.item_movement_reports set unresolved_count = unique_item_count;
  return jsonb_build_object('ok', true, 'deleted_items', v_items, 'deleted_aliases', v_aliases, 'preserved_reports', v_reports);
end;
$$;
revoke all on function public.reset_item_catalog() from public, anon, authenticated;
grant execute on function public.reset_item_catalog() to service_role;

-- ============================================================================
-- Later production migrations consolidated for fresh V85 installations.
-- Existing installations should run only supabase/migrations/V85_repair_hardening.sql.
-- ============================================================================

-- BEGIN V46_report_drafts.sql
create table if not exists public.report_drafts (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.profiles(id) on delete cascade,
 title text,
 report_period_start text,
 report_period_end text,
 prepared_by text,
 absences text,
 problems text,
 notes text,
 achievements text,
 next_plan text,
 created_at timestamptz default now(),
 updated_at timestamptz default now()
);

-- END V46_report_drafts.sql

-- BEGIN V65_supplier_external_signed_balances.sql
-- V65 — Signed supplier external balances
-- Positive value from supplier report = debt for us.
-- Negative value from supplier report = debt on us.
-- Zero = no debt.

create table if not exists public.supplier_external_balances (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  signed_balance numeric(14,2) not null default 0,
  reference_no text,
  last_payment_date date,
  last_invoice_date date,
  source text not null default 'supplier_import',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, branch_id)
);

create index if not exists supplier_external_balances_supplier_idx on public.supplier_external_balances(supplier_id);
create index if not exists supplier_external_balances_branch_idx on public.supplier_external_balances(branch_id);
create index if not exists supplier_external_balances_signed_idx on public.supplier_external_balances(signed_balance);

revoke all on table public.supplier_external_balances from anon, authenticated;
grant all on table public.supplier_external_balances to service_role;

-- END V65_supplier_external_signed_balances.sql

-- BEGIN V72_item_purchase_archive.sql
-- V72 — Persistent purchase archive for advanced item movement analysis.
-- Stores the full purchase report once, then monthly sales reports can use the
-- matching purchase rows by date without uploading purchases every month.

create table if not exists public.item_purchase_imports (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  source_name text,
  source_filename text,
  period_start date not null,
  period_end date not null,
  row_count integer not null default 0 check (row_count >= 0),
  unique_item_count integer not null default 0 check (unique_item_count >= 0),
  unresolved_count integer not null default 0 check (unresolved_count >= 0),
  total_purchase_value numeric(18,6) not null default 0,
  total_equivalent_boxes numeric(18,6) not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists item_purchase_imports_branch_created_idx
  on public.item_purchase_imports(branch_id, created_at desc);

create table if not exists public.item_purchase_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.item_purchase_imports(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  purchase_date date not null,
  supplier_name text,
  invoice_number text,
  report_name text not null,
  report_name_norm text not null,
  item_id uuid references public.item_catalog(id) on delete set null,
  unit text not null check (unit in ('علبة','فرط')),
  quantity numeric(16,6) not null default 0,
  boxes_purchased numeric(16,6) not null default 0,
  loose_purchased numeric(16,6) not null default 0,
  units_per_box integer check (units_per_box > 0),
  equivalent_boxes numeric(18,6),
  purchase_value numeric(18,6) not null default 0,
  matched_by text not null default 'unmatched' check (matched_by in ('exact','alias','manual','unmatched')),
  created_at timestamptz not null default now()
);
create index if not exists item_purchase_rows_import_idx on public.item_purchase_rows(import_id);
create index if not exists item_purchase_rows_branch_date_idx on public.item_purchase_rows(branch_id, purchase_date);
create index if not exists item_purchase_rows_item_idx on public.item_purchase_rows(item_id);
create index if not exists item_purchase_rows_unmatched_idx on public.item_purchase_rows(import_id, matched_by);

alter table public.item_purchase_imports enable row level security;
alter table public.item_purchase_rows enable row level security;

revoke all on table public.item_purchase_imports, public.item_purchase_rows
  from anon, authenticated;

-- END V72_item_purchase_archive.sql

-- BEGIN V76_user_tasks.sql
-- V76 - Personal To Do List / Abdo Tasks
-- Run once in Supabase SQL Editor.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) >= 2 and char_length(title) <= 180),
  description text,
  priority text not null default 'normal' check (priority in ('urgent','important','normal')),
  status text not null default 'new' check (status in ('new','in_progress','postponed','completed')),
  due_date date,
  branch_id uuid references public.branches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_user_status_due on public.tasks(user_id, status, due_date);
create index if not exists idx_tasks_branch on public.tasks(branch_id);

create or replace function public.touch_tasks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
before update on public.tasks
for each row execute function public.touch_tasks_updated_at();

alter table public.tasks enable row level security;

drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own on public.tasks for select using (auth.uid() = user_id);

drop policy if exists tasks_insert_own on public.tasks;
create policy tasks_insert_own on public.tasks for insert with check (auth.uid() = user_id);

drop policy if exists tasks_update_own on public.tasks;
create policy tasks_update_own on public.tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists tasks_delete_own on public.tasks;
create policy tasks_delete_own on public.tasks for delete using (auth.uid() = user_id);

-- END V76_user_tasks.sql

-- BEGIN V78_daily_note_books.sql
-- V78 - Daily employee/title notes inside Abdo Tasks
-- Run once in Supabase SQL Editor after V76_user_tasks.sql.

create table if not exists public.daily_note_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) >= 2 and char_length(title) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid not null references public.daily_note_books(id) on delete cascade,
  note_text text not null check (char_length(trim(note_text)) >= 2 and char_length(note_text) <= 2500),
  note_date date default current_date,
  priority text not null default 'normal' check (priority in ('urgent','important','normal')),
  followed_up boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_daily_note_books_user_updated on public.daily_note_books(user_id, updated_at desc);
create index if not exists idx_daily_notes_user_book_date on public.daily_notes(user_id, book_id, note_date desc);
create index if not exists idx_daily_notes_followed_up on public.daily_notes(user_id, followed_up);

create or replace function public.touch_daily_note_books_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_daily_note_books_updated_at on public.daily_note_books;
create trigger trg_daily_note_books_updated_at
before update on public.daily_note_books
for each row execute function public.touch_daily_note_books_updated_at();

create or replace function public.touch_daily_notes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_daily_notes_updated_at on public.daily_notes;
create trigger trg_daily_notes_updated_at
before update on public.daily_notes
for each row execute function public.touch_daily_notes_updated_at();

alter table public.daily_note_books enable row level security;
alter table public.daily_notes enable row level security;

drop policy if exists daily_note_books_select_own on public.daily_note_books;
create policy daily_note_books_select_own on public.daily_note_books for select using (auth.uid() = user_id);

drop policy if exists daily_note_books_insert_own on public.daily_note_books;
create policy daily_note_books_insert_own on public.daily_note_books for insert with check (auth.uid() = user_id);

drop policy if exists daily_note_books_update_own on public.daily_note_books;
create policy daily_note_books_update_own on public.daily_note_books for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists daily_note_books_delete_own on public.daily_note_books;
create policy daily_note_books_delete_own on public.daily_note_books for delete using (auth.uid() = user_id);

drop policy if exists daily_notes_select_own on public.daily_notes;
create policy daily_notes_select_own on public.daily_notes for select using (auth.uid() = user_id);

drop policy if exists daily_notes_insert_own on public.daily_notes;
create policy daily_notes_insert_own on public.daily_notes for insert with check (auth.uid() = user_id);

drop policy if exists daily_notes_update_own on public.daily_notes;
create policy daily_notes_update_own on public.daily_notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists daily_notes_delete_own on public.daily_notes;
create policy daily_notes_delete_own on public.daily_notes for delete using (auth.uid() = user_id);

-- END V78_daily_note_books.sql

-- BEGIN V81_employee_accounts.sql
-- V81 - Employee payroll/activity cards inside Abdo Tasks
-- Run once in Supabase SQL Editor after V78_daily_note_books.sql.

create table if not exists public.employee_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 2 and char_length(name) <= 160),
  base_salary numeric(14,2) not null default 0 check (base_salary >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.employee_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  employee_id uuid not null,
  record_type text not null check (record_type in ('absence','withdrawal','credit','overtime')),
  record_date date not null default current_date,
  quantity numeric(12,2) not null default 0 check (quantity >= 0),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  note text check (note is null or char_length(note) <= 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_records_employee_owner_fk foreign key (employee_id, user_id) references public.employee_cards(id, user_id) on delete cascade
);

create index if not exists idx_employee_cards_user_name on public.employee_cards(user_id, name);
create index if not exists idx_employee_records_user_employee_date on public.employee_records(user_id, employee_id, record_date desc);
create index if not exists idx_employee_records_user_type_date on public.employee_records(user_id, record_type, record_date desc);

create or replace function public.touch_employee_cards_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_employee_cards_updated_at on public.employee_cards;
create trigger trg_employee_cards_updated_at
before update on public.employee_cards
for each row execute function public.touch_employee_cards_updated_at();

create or replace function public.touch_employee_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_employee_records_updated_at on public.employee_records;
create trigger trg_employee_records_updated_at
before update on public.employee_records
for each row execute function public.touch_employee_records_updated_at();

create or replace function public.touch_employee_card_from_record()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    update public.employee_cards set updated_at = now() where id = old.employee_id;
  else
    update public.employee_cards set updated_at = now() where id = new.employee_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_employee_record_touch_parent on public.employee_records;
create trigger trg_employee_record_touch_parent
after insert or update or delete on public.employee_records
for each row execute function public.touch_employee_card_from_record();

alter table public.employee_cards enable row level security;
alter table public.employee_records enable row level security;

drop policy if exists employee_cards_select_own on public.employee_cards;
create policy employee_cards_select_own on public.employee_cards for select using (auth.uid() = user_id);

drop policy if exists employee_cards_insert_own on public.employee_cards;
create policy employee_cards_insert_own on public.employee_cards for insert with check (auth.uid() = user_id);

drop policy if exists employee_cards_update_own on public.employee_cards;
create policy employee_cards_update_own on public.employee_cards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists employee_cards_delete_own on public.employee_cards;
create policy employee_cards_delete_own on public.employee_cards for delete using (auth.uid() = user_id);

drop policy if exists employee_records_select_own on public.employee_records;
create policy employee_records_select_own on public.employee_records for select using (auth.uid() = user_id);

drop policy if exists employee_records_insert_own on public.employee_records;
create policy employee_records_insert_own on public.employee_records for insert with check (auth.uid() = user_id);

drop policy if exists employee_records_update_own on public.employee_records;
create policy employee_records_update_own on public.employee_records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists employee_records_delete_own on public.employee_records;
create policy employee_records_delete_own on public.employee_records for delete using (auth.uid() = user_id);

-- END V81_employee_accounts.sql

-- BEGIN V82_employee_notes.sql
-- V82 - Add dated manual notes to each employee card
-- Run once after V81_employee_accounts.sql.

alter table public.employee_records
  drop constraint if exists employee_records_record_type_check;

alter table public.employee_records
  add constraint employee_records_record_type_check
  check (record_type in ('absence','withdrawal','credit','overtime','note'));

-- END V82_employee_notes.sql

-- BEGIN V85_repair_hardening.sql
-- V85 — Repair & hardening release
-- Run ONCE on an existing V84 database before deploying the V85 application.
-- Main goals:
--   1) Stage movement/purchase imports and activate them atomically.
--   2) Keep the last known-good report visible if a new import fails halfway.
--   3) Harden newer private tables so the browser cannot access them directly.

-- ---------------------------------------------------------------------------
-- Atomic item movement imports
-- ---------------------------------------------------------------------------
alter table public.item_movement_reports
  add column if not exists is_current boolean not null default true;

-- V18 used a full UNIQUE constraint, which prevents staging a replacement.
-- Drop the normal autogenerated name first, then defensively handle databases
-- where PostgreSQL/older SQL used a different constraint name.
alter table public.item_movement_reports
  drop constraint if exists item_movement_reports_branch_id_period_start_period_end_key;

do $$
declare
  v_constraint text;
begin
  select c.conname
    into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.item_movement_reports'::regclass
     and c.contype = 'u'
     and replace(pg_get_constraintdef(c.oid), ' ', '') ilike '%UNIQUE(branch_id,period_start,period_end)%'
   limit 1;
  if v_constraint is not null then
    execute format('alter table public.item_movement_reports drop constraint %I', v_constraint);
  end if;
end;
$$;

create unique index if not exists item_movement_reports_current_period_uidx
  on public.item_movement_reports(branch_id, period_start, period_end)
  where is_current;

create index if not exists item_movement_reports_current_branch_period_idx
  on public.item_movement_reports(branch_id, is_current, period_end desc);

create or replace function public.activate_item_movement_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_start date;
  v_end date;
begin
  select branch_id, period_start, period_end
    into v_branch, v_start, v_end
    from public.item_movement_reports
   where id = p_report_id
   for update;

  if not found then
    raise exception 'Movement report not found';
  end if;

  -- The old report remains current until this function runs, so failed uploads
  -- never remove the last known-good report.
  update public.item_movement_reports
     set is_current = false
   where branch_id = v_branch
     and period_start = v_start
     and period_end = v_end
     and id <> p_report_id
     and is_current;

  update public.item_movement_reports
     set is_current = true
   where id = p_report_id;

  -- Clean the replaced version plus any abandoned staged attempts for the same period.
  delete from public.item_movement_reports
   where branch_id = v_branch
     and period_start = v_start
     and period_end = v_end
     and id <> p_report_id
     and not is_current;
end;
$$;

revoke all on function public.activate_item_movement_report(uuid) from public, anon, authenticated;
grant execute on function public.activate_item_movement_report(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Atomic purchase archive imports
-- ---------------------------------------------------------------------------
alter table public.item_purchase_imports
  add column if not exists is_current boolean not null default true;

-- Older versions intended one purchase archive per branch. If historical rows
-- exist, preserve only the newest one as current; older rows stay staged until
-- the next successful activation cleans them.
with ranked as (
  select id,
         row_number() over (partition by branch_id order by created_at desc, id desc) as rn
    from public.item_purchase_imports
)
update public.item_purchase_imports p
   set is_current = (r.rn = 1)
  from ranked r
 where p.id = r.id;

create unique index if not exists item_purchase_imports_current_branch_uidx
  on public.item_purchase_imports(branch_id)
  where is_current;

create index if not exists item_purchase_imports_current_created_idx
  on public.item_purchase_imports(branch_id, is_current, created_at desc);

create or replace function public.activate_item_purchase_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
begin
  select branch_id
    into v_branch
    from public.item_purchase_imports
   where id = p_import_id
   for update;

  if not found then
    raise exception 'Purchase import not found';
  end if;

  update public.item_purchase_imports
     set is_current = false
   where branch_id = v_branch
     and id <> p_import_id
     and is_current;

  update public.item_purchase_imports
     set is_current = true
   where id = p_import_id;

  -- Remove the replaced archive and any abandoned staged uploads for this branch.
  delete from public.item_purchase_imports
   where branch_id = v_branch
     and id <> p_import_id
     and not is_current;
end;
$$;

revoke all on function public.activate_item_purchase_import(uuid) from public, anon, authenticated;
grant execute on function public.activate_item_purchase_import(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Harden tables introduced after the original schema snapshot.
-- The application talks to Supabase through FastAPI/service_role only.
-- ---------------------------------------------------------------------------
alter table if exists public.report_drafts enable row level security;
alter table if exists public.supplier_external_balances enable row level security;
alter table if exists public.item_purchase_imports enable row level security;
alter table if exists public.item_purchase_rows enable row level security;
alter table if exists public.tasks enable row level security;
alter table if exists public.daily_note_books enable row level security;
alter table if exists public.daily_notes enable row level security;
alter table if exists public.employee_cards enable row level security;
alter table if exists public.employee_records enable row level security;

revoke all on table public.report_drafts,
  public.supplier_external_balances,
  public.item_purchase_imports,
  public.item_purchase_rows,
  public.tasks,
  public.daily_note_books,
  public.daily_notes,
  public.employee_cards,
  public.employee_records
from anon, authenticated;

-- END V85_repair_hardening.sql

-- BEGIN V86_employee_branch_performance.sql
-- V86 — Shared employees by branch + long-term paging support
alter table public.employee_cards
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;

with one_branch as (
  select profile_id, min(branch_id::text)::uuid as branch_id
  from public.profile_branches
  group by profile_id
  having count(*) = 1
)
update public.employee_cards ec
set branch_id = ob.branch_id
from one_branch ob
where ec.branch_id is null
  and ec.user_id = ob.profile_id;

alter table public.employee_records
  drop constraint if exists employee_records_employee_owner_fk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_records_employee_fk'
      AND conrelid = 'public.employee_records'::regclass
  ) THEN
    ALTER TABLE public.employee_records
      ADD CONSTRAINT employee_records_employee_fk
      FOREIGN KEY (employee_id) REFERENCES public.employee_cards(id) ON DELETE CASCADE;
  END IF;
END $$;

create index if not exists idx_employee_cards_branch_name
  on public.employee_cards(branch_id, name);
create index if not exists idx_employee_records_employee_date
  on public.employee_records(employee_id, record_date desc, created_at desc);
revoke all on table public.employee_cards, public.employee_records from anon, authenticated;
-- END V86_employee_branch_performance.sql
