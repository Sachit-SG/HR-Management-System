-- Gender on employee profiles + allow authenticated reads of multi-store assignments
-- (writes still go through server actions with USERS_MANAGE + service role).

alter table public.employees
  add column if not exists gender text;

comment on column public.employees.gender is
  'Optional gender for HR records: female, male, non_binary, prefer_not_to_say, other.';

-- Managers viewing the user directory need to see all store assignments, not only self/owner.
drop policy if exists "employee_location_assignments_select_self_or_owner"
  on public.employee_location_assignments;

drop policy if exists "employee_location_assignments_select_auth"
  on public.employee_location_assignments;

create policy "employee_location_assignments_select_auth"
  on public.employee_location_assignments for select to authenticated
  using (true);
