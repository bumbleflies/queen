## Summary
<!-- What changed and why. Link the issue this closes, e.g. "Closes #42". -->

## Test plan
<!-- Check off what you actually ran. See CONTRIBUTING.md § Verification & Completion. -->
- [ ] `npm run lint` passes (zero errors)
- [ ] `npm run typecheck` and `npm run typecheck:server` pass
- [ ] `npm test` passes, with clean output (no unexpected `[ledger] … failed` lines)
- [ ] UI changes checked in the running app: DE + EN, light + dark, mobile width
- [ ] New UI strings added to both `src/client/i18n/de.ts` and `en.ts`
- [ ] Verified on servyy-test after release (if it ships behaviour)

## Domain invariants
<!-- Delete this section if the PR doesn't touch invoices, money, numbering or the ledger. -->
- [ ] Money stays in integer cents; VAT per line, half-up
- [ ] No issued invoice is deleted or reopened; corrections are Stornorechnungen
- [ ] Journal entries are only written through `ledger.ts` (`post`/`postOnce`/`reverse`), never updated or deleted
- [ ] Ledger side effects are wrapped in `safeLedger` and covered by backfill

## Infra / deployment changes
<!-- Delete this section if the PR doesn't touch the Dockerfile, workflows or env config. -->
- [ ] Container/env changes are made in `dachrisch/servyy-container` (Ansible), not by hand
- [ ] Validated on servyy-test before targeting production
- [ ] `.env.example` updated for new variables; no secrets committed

## Data hygiene
- [ ] No customer data, company figures or secrets in code, tests, fixtures, docs or screenshots

## Notes for reviewers
<!-- Anything that isn't obvious from the diff: tradeoffs, follow-ups, things you're unsure about. -->
