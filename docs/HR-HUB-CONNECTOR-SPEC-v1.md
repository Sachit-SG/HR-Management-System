# HR ↔ QuickTrack Hub Connector Spec (v1)

**Status:** HR side implemented (read-only internal APIs). Hub side: add tools in `tool-schema.ts` + connector (mirror Master DB pattern).

**HR base URL (examples):**

- Local: `http://localhost:3000`
- Production: `https://hr.yourcompany.com` (set on Hub as `HR_APP_URL`)

---

## Authentication

| Item | Value |
|------|--------|
| Header | `x-internal-api-key` (also accepts `x-hr-internal-api-key` or `Authorization: Bearer …`) |
| HR env | `HR_INTERNAL_ASSISTANT_API_KEY` (server-only, never `NEXT_PUBLIC_`) |
| Hub env (suggested) | `HR_APP_URL`, `HR_APP_API_KEY` (same secret as HR key) |
| Disable connector | `HR_ASSISTANT_CONNECTOR_ENABLED=false` on HR → 503 |

### Hub user context (required on data endpoints)

Hub must send the signed-in user on every data request (not required on `/health`):

| Header | Value |
|--------|--------|
| `x-hub-user-email` | Hub session email (also accepts `x-user-email`) |
| `x-hub-user-role` | `ADMIN` or `STAFF` (also accepts `x-user-role`) |

HR resolves the email to an active `employees` row and enforces tiered access in `lib/internal-assistant/access.ts`:

| Tier | Who | Scope |
|------|-----|--------|
| **admin** | Hub `ADMIN`, or HR org owner | All stores / employees |
| **manager** | HR store manager / shift lead with time-clock manage | Assigned `location_id` only |
| **employee** | Everyone else | Self lookup + own PTO only |

Missing user email → `403`. Hub `STAFF` without a linked HR employee → `403`.

Middleware: `/api/internal/assistant/*` skips user login redirect; routes validate API key + Hub user context.

---

## Health (no API key)

```
GET /api/internal/assistant/health
```

Response:

```json
{
  "ok": true,
  "service": "hr-management-system",
  "connectorEnabled": true,
  "keyConfigured": true,
  "supabaseConfigured": true,
  "ready": true
}
```

---

## Tools for Hub LLM router (v1 read-only)

| Tool name (suggested) | User intent | HR endpoint |
|----------------------|-------------|-------------|
| `hr_employee_lookup` | Find employee by name, email, code | `GET /api/internal/assistant/employee-lookup?q=` |
| `hr_pto_balance` | PTO / vacation / sick balance | `GET /api/internal/assistant/pto-balance?employeeId=` |
| `hr_clocked_in` | Who is clocked in at a store | `GET /api/internal/assistant/clocked-in?location=` |
| `hr_pending_time_off` | Pending time-off requests at store | `GET /api/internal/assistant/pending-time-off?location=` |
| `hr_location_roster_summary` | Active headcount + clocked in now | `GET /api/internal/assistant/location-roster-summary?location=` |

### Example tool descriptions (for `tool-schema.ts`)

- **hr_employee_lookup:** Resolve an active employee by email, UUID, employee code, or partial name. Returns up to 10 matches.
- **hr_pto_balance:** Vacation and sick hour balances for one employee ID.
- **hr_clocked_in:** Open punches (no clock-out) at a location; pass location UUID or store name substring.
- **hr_pending_time_off:** Pending approval requests for employees at a location.
- **hr_location_roster_summary:** Count of active employees and how many are clocked in now.

---

## Endpoint details

### Employee lookup

```
GET /api/internal/assistant/employee-lookup?q=riley@company.com
```

Success `200`:

```json
{
  "ok": true,
  "count": 1,
  "employees": [
    {
      "id": "uuid",
      "fullName": "Riley Smith",
      "email": "riley@company.com",
      "employeeCode": "E102",
      "role": "Store Manager",
      "storeName": "Flagship",
      "locationId": "uuid"
    }
  ]
}
```

### PTO balance

```
GET /api/internal/assistant/pto-balance?employeeId=<uuid>
```

Success `200`:

```json
{
  "ok": true,
  "employeeId": "uuid",
  "fullName": "Riley Smith",
  "email": "riley@company.com",
  "vacationHours": 40,
  "sickHours": 24
}
```

### Clocked in

```
GET /api/internal/assistant/clocked-in?location=Flagship
```

Success `200`:

```json
{
  "ok": true,
  "location": { "id": "uuid", "name": "Flagship", "status": "running" },
  "clockedInCount": 3,
  "clockedIn": [
    {
      "timeEntryId": "uuid",
      "clockInAt": "2026-05-26T14:00:00.000Z",
      "employeeId": "uuid",
      "fullName": "Alex",
      "email": "alex@company.com",
      "employeeCode": "E55"
    }
  ]
}
```

### Pending time off

```
GET /api/internal/assistant/pending-time-off?locationId=<uuid>
```

### Location roster summary

```
GET /api/internal/assistant/location-roster-summary?store=buna
```

Success `200`:

```json
{
  "ok": true,
  "location": { "id": "uuid", "name": "Buna", "status": "running" },
  "activeEmployees": 12,
  "clockedInNow": 4
}
```

### Errors

| Status | Body |
|--------|------|
| 401 | `{ "ok": false, "error": "...", "reason": "invalid_api_key" }` |
| 404 | `{ "ok": false, "error": "Employee not found." }` |
| 503 | Connector disabled or HR key not configured |

---

## Logging (HR)

Prefix: `[HR][INTERNAL_ASSISTANT][REQUEST|RESPONSE|ERROR]`

Hub should log `[HR][REQUEST]` when calling these endpoints for cross-app tracing.

---

## Local test (curl)

```bash
export HR_KEY="your-secret"
export BASE="http://localhost:3000"

curl -s "$BASE/api/internal/assistant/health" | jq .

curl -s -H "x-internal-api-key: $HR_KEY" \
  "$BASE/api/internal/assistant/employee-lookup?q=dev@retailhr.local" | jq .

curl -s -H "x-internal-api-key: $HR_KEY" \
  "$BASE/api/internal/assistant/location-roster-summary?location=Flagship" | jq .
```

---

## Out of scope (v2)

- Write actions (approve PTO, adjust punches) via assistant
- Per-user RBAC from Hub identity headers
- Master DB store code → HR location ID mapping (Hub may resolve store first, then pass location name/UUID)

---

## Hub checklist (for teammate)

- [ ] Add `HR_APP_URL` + `HR_APP_API_KEY` to Hub env / Doppler
- [ ] Create `connectors/hr.ts` calling endpoints above
- [ ] Register 5 tools in `tool-schema.ts`
- [ ] Test prompts: “PTO balance for …”, “who is clocked in at …”, “pending time off at …”
- [ ] Confirm logs on both sides
