-- V86 — Shared employees by branch + long-term paging support
-- Run ONCE on an existing V85 database before deploying V86.

-- 1) Employee cards now belong to a branch so branch managers can share the same
--    employee/payroll history instead of each login having a separate private copy.
alter table public.employee_cards
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;

-- Safe automatic migration: if the employee owner is assigned to exactly one branch,
-- attach their old employee cards to that branch. Multi-branch/all-branch owners stay
-- unassigned (NULL) until they edit the card and choose the correct branch.
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

-- Records are shared through the employee card. Keep user_id as the creator/audit user,
-- but do not require the record creator to be the same user who originally created card.
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

-- Keep direct Supabase browser access locked down; FastAPI performs permission + branch checks.
revoke all on table public.employee_cards, public.employee_records from anon, authenticated;
