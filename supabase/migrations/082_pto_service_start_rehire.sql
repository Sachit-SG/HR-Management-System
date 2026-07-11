-- PTO years-of-service: when rehired_at is set, accrual tiers use the rehire
-- date instead of the original employment_start_date (boomerang employees).

create or replace function public.pto_service_start_date(
  p_employment_start date,
  p_rehired_at timestamptz
)
returns date
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(p_rehired_at::date, p_employment_start);
$$;

comment on function public.pto_service_start_date(date, timestamptz) is
  'Effective service start for PTO accrual: rehire date when present, else original hire date.';

create or replace function public.pto_entitlement_hours_for_employee(
  p_employee_id uuid,
  p_bucket text,
  p_as_of date
)
returns numeric
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  emp record;
  pol record;
  emp_cohort text;
  service_start date;
  yos int;
  hours numeric;
begin
  select e.id, e.role, e.employment_start_date, e.rehired_at, e.fte_ratio, e.pto_cohort
  into emp
  from public.employees e
  where e.id = p_employee_id;

  if emp.id is null then
    return 0;
  end if;

  select p.id, p.standard_day_hours
  into pol
  from public.pto_policies p
  order by p.created_at asc
  limit 1;

  emp_cohort := coalesce(nullif(trim(emp.pto_cohort), ''), public.pto_employee_cohort(emp.role));
  service_start := public.pto_service_start_date(emp.employment_start_date, emp.rehired_at);
  yos := public.pto_years_of_service(service_start, p_as_of);

  select t.annual_hours
  into hours
  from public.pto_entitlement_tiers t
  where t.policy_id = pol.id
    and t.bucket = p_bucket
    and t.min_years_of_service <= yos
    and (
      (p_bucket = 'sick' and t.cohort = 'all')
      or (p_bucket = 'vacation' and t.cohort = emp_cohort)
    )
  order by t.min_years_of_service desc
  limit 1;

  hours := coalesce(hours, 0);

  if p_bucket = 'vacation' then
    hours := hours * coalesce(emp.fte_ratio, 1);
  end if;

  return greatest(0, hours);
end;
$$;

comment on function public.pto_entitlement_hours_for_employee(uuid, text, date) is
  'Annual entitlement (hours) for an employee + bucket. Years-of-service uses rehired_at when set, else employment_start_date.';
