# HR data access & Hub assistant security plan

**Author:** Sachit Ghimire (brainstorm / future work)  
**Created:** 2026-06-24  
**Trigger:** Lessons from QuickTrack Hub **Store Info / Master DB assistant audit** (2026-06-22)  
**Status:** Planning only — **not required for employee pilot**

Read this before enabling Hub AI for HR or changing `app/api/internal/assistant/*`.

Related: `docs/HR-HUB-CONNECTOR-SPEC-v1.md`, Hub `docs/HR-EMBED-PLAN.md` (Hub AI = **last** priority).

---

## Why this doc exists

The Store Info team audited their Hub ↔ Master DB connector and found:

- API key auth is **not** enough when **any logged-in Hub user** can use the assistant.
- One “broad” endpoint can mix **staff-safe** and **restricted** data.
- Production env and logging need explicit review.

HR uses the **same integration pattern** (thin `/api/internal/assistant/*` layer). The **main HR app** already has RBAC in the UI; the **assistant path does not yet**.

---

## Two ways users access HR data

| Path | Who | Security today | Pilot? |
|------|-----|----------------|--------|
| **HR web app** (pages + server actions) | Employees, managers, admins | Supabase session + `employees.role` + `admin_access` | ✅ Yes — this is the pilot |
| **Hub assistant** → `connectors/hr.ts` → `/api/internal/assistant/*` | Anyone with Hub login (when wired) | API key only — **no per-user filter** | ❌ Not yet — do not enable for all staff |

Do not confuse them. Pilot = app path. This doc = assistant path.

---

## Data sensitivity (HR)

### Staff-safe (OK for any authenticated employee, scoped to self or public store ops)

- Own clock in/out, own schedule, own profile (non-admin fields)
- Store name / location they work at
- Generic “how do I use the time clock” help

### Manager / lead (store-scoped)

- Who is clocked in **at their store(s)**
- Pending time-off for **their team**
- Roster headcount + clocked-in count **for their location**
- Employee lookup **within their stores** (name, code — minimize email exposure)

### Admin / HR / owner

- Cross-store employee lookup (including email)
- PTO balances for any employee
- Full roster summaries, exports, payroll prep data
- User admin, permissions, archive

### Restricted (never via casual assistant chat)

- Hourly pay rates, banking, SSN/tax IDs (if ever stored)
- Bulk export of all employee emails
- Write actions (approve PTO, adjust punches) via chat — **out of scope v1**

---

## Internal assistant endpoints — current vs target

Today all routes below accept **only** `x-internal-api-key`. Any Hub caller with the key gets **full** JSON.

| Endpoint | Returns sensitive data? | Target when Hub AI goes live |
|----------|-------------------------|------------------------------|
| `GET .../health` | No | Open (no key) — keep as-is |
| `GET .../employee-lookup` | Email, role, store | Filter by Hub user role + store scope |
| `GET .../pto-balance` | Vacation/sick hours | **Self only** for employees; managers+ for others |
| `GET .../clocked-in` | Names, emails at store | **Managers+** for that store only |
| `GET .../pending-time-off` | Team PTO requests | **Managers+** for that store only |
| `GET .../location-roster-summary` | Counts only | Managers+ for store; or staff-safe counts only |

**Learn from Store Info:** avoid a single “give me everything” response; return the **minimum** fields for the intent.

---

## Implementation checklist (before Hub AI for HR)

Use this as a gate — do not merge Hub assistant HR tools to prod for all roles until these are done or explicitly accepted by platform owner.

### HR repo (`hr-management-system`)

- [ ] Accept Hub user context headers (coordinate with Hub Phase 1D): e.g. `x-user-email`, `x-user-role` (exact names TBD with Aryan).
- [ ] Map Hub role → HR capability tier (employee / manager / admin).
- [ ] Enforce scope in `lib/internal-assistant/services.ts` (not only in Hub).
- [ ] Employee tier: reject cross-employee PTO / clocked-in / lookup except self.
- [ ] Manager tier: resolve allowed `location_id`(s) from employee record; reject other stores.
- [ ] Trim response fields per tier (e.g. hide email on staff-safe lookup).
- [ ] Audit logs: never log emails, PTO balances, or full employee lists in `[HR][INTERNAL_ASSISTANT]` payloads.
- [ ] Prod env checklist: `HR_INTERNAL_ASSISTANT_API_KEY`, `SSO_SHARED_SECRET`, `HR_ASSISTANT_CONNECTOR_ENABLED`.

### Hub repo (`quicktrackhub`)

- [ ] `connectors/hr.ts` sends user context headers on every request.
- [ ] `tool-executor.ts` / `router.ts`: do not expose HR tools to `STAFF` role without HR-side enforcement (defense in depth).
- [ ] Register only tools that match existing HR routes (no Hub tool without HR endpoint).
- [ ] `OPENAI_API_KEY` + LLM path tested; regex fallback documented.

### Docs / QA

- [ ] Update `HR-HUB-CONNECTOR-SPEC-v1.md` when headers are agreed.
- [ ] Manual matrix: test as employee, manager, admin — same prompt, different allowed answers.
- [ ] Cross-reference Store Info capability map when platform team finalizes global pattern.

---

## What we already did right (don’t redo)

- Employee portal: no manager store picker, no admin profile fields, schedule → own store.
- Hub → HR SSO (CPS-aligned `hub_account_links`).
- Internal assistant: timing-safe API key compare, connector disable flag, structured log prefix.
- Hub AI explicitly **last** in `HR-EMBED-PLAN.md`.

---

## What NOT to do

- Do not add a large public REST API surface for pilot.
- Do not block pilot on this doc — pilot uses the **HR app**, not Hub chat.
- Do not copy Store Info’s EIN/owner rules literally; HR sensitive data is **employee / PTO / roster**, not tax IDs.
- Do not implement ADP / Connecteam payroll sync here; see separate payroll export roadmap.

---

## Payroll note (brainstorm)

- **ADP** = company payroll (paychecks). Not part of assistant security.
- **Connecteam → ADP** = existing ops path during transition.
- **HR → ADP** = future phase after HR is source of truth for hours (CSV or paydata integration).

---

## When to re-read this

- Opening a PR that touches `app/api/internal/assistant/*` or `lib/internal-assistant/*`
- Hub teammate asks to “turn on HR assistant tools”
- Adding a new assistant endpoint or Hub connector tool
- Expanding Hub `STAFF` role access to Operations / assistant

---

## References

- Hub Store Info audit (teammate, 2026-06-22): architecture audit, staff-safe vs restricted classification, role matrix gap.
- `docs/HR-HUB-CONNECTOR-SPEC-v1.md` — v1 endpoints; v2 defers per-user RBAC from Hub headers.
- `docs/HR-ROSTER-DATA-GAP-REPORT.md` — rollout / SSO / roster (separate from assistant security).
