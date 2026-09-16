-- V82 - Add dated manual notes to each employee card
-- Run once after V81_employee_accounts.sql.

alter table public.employee_records
  drop constraint if exists employee_records_record_type_check;

alter table public.employee_records
  add constraint employee_records_record_type_check
  check (record_type in ('absence','withdrawal','credit','overtime','note'));
