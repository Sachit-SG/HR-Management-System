# HR integration readiness checklist

Use this to show the team HR is prepared for monorepo, Doppler, and QuickTrack Hub.

## Hub connector (HR repo) — done in code

- [x] Internal APIs under `/api/internal/assistant/*`
- [x] API key auth (`HR_INTERNAL_ASSISTANT_API_KEY`)
- [x] Spec for Hub teammate: `docs/HR-HUB-CONNECTOR-SPEC-v1.md`
- [ ] Hub registers tools + `connectors/hr.ts` (Hub repo — teammate)
- [ ] Shared API key in Doppler/Vercel on both sides

## Doppler — ready to enable

- [x] `doppler.yaml` (`hr-system` / `dev`)
- [x] `npm run dev:doppler`
- [x] `docs/doppler-hr.md`
- [ ] Invite devs to Doppler workspace
- [ ] Upload secrets from HR Vercel
- [ ] Vercel ↔ Doppler sync (optional)

## Monorepo — prepared, not moved

- [ ] Company repo `lama-group-portal` exists
- [ ] Subtree import to `apps/hr-system`
- [ ] New Vercel root dir `apps/hr-system`
- See `docs/HR-TRANSFER-GUIDEBOOK.md`

## SSO / IdP — Phase 2

- [ ] IdP choice (Clerk vs Auth0 vs Supabase-only)
- [ ] Hub cookie domain plan
- HR keeps separate Supabase DB

## Quick demo for team (5 min)

```bash
# .env.local: HR_INTERNAL_ASSISTANT_API_KEY=test-secret-local
npm run dev

curl -s http://localhost:3000/api/internal/assistant/health | jq .
curl -s -H "x-internal-api-key: test-secret-local" \
  "http://localhost:3000/api/internal/assistant/location-roster-summary?location=Flagship" | jq .
```

Post in Slack: link to `HR-HUB-CONNECTOR-SPEC-v1.md` + screenshot of health/clocked-in JSON.
