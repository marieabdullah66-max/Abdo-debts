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
