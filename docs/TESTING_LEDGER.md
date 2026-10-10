# Open Design AI — Testing Ledger

**Branch:** `action-ledger-development`  
**Last updated:** 2026-10-10  
**Purpose:** Single source of truth for testing work, code changes, CI, evidence, defects, and remaining coverage. Update this file as work progresses; do not mark a test passed without evidence.

## Current status

- [x] Input classification fix committed.
- [x] Type-appropriate synthetic values for text, email, URL, telephone, password, and search fields committed.
- [x] Native malformed email/URL validation committed.
- [x] Stateful control verification strengthened: checkbox/radio/toggle must show a state change; expand/collapse must show an expanded-state change.
- [x] Form-level invalid-input candidates restricted to supported email and URL fields.
- [x] Link origin detection now compares parsed URL origins instead of string prefixes; unknown/malformed destinations are conservatively classified as external.
- [x] Expanded action-risk classification to treat purchases, payments, refunds, transfers, outbound messages, publishing/deploying, invitations, access changes, and password changes as destructive/consequential candidates blocked by default.
- [x] Earlier TypeScript validation run #28 passed at commit `55cb0aa82f80df94fe87a010124591ce7e09d454`.
- [x] TypeScript validation passed for both latest code commits (#29 and #30).
- [ ] Run browser fixture tests for the classification matrix.
- [ ] Run end-to-end verification against a real sample app.
- [ ] Confirm build/deployment and full coverage behavior.

## Recent code changes

| Commit | Change | Status |
|---|---|---|
| `4a24dbce8e788c46e943a48f2b4eed1610ef7f72` | Classify text-entry controls separately from choice/action controls | Committed |
| `312809179c3fccc5747c395eb21fb90a4ab7fd68` | Limit required validation to supported text fields | Committed |
| `59da1bc168018f6da32eb13a203bcb122e006318` | Limit invalid-input tests to supported native types | Committed |
| `f3d67453f8c03ae5192407ec17deb8e18ca4ce4b` | Use type-appropriate synthetic input values | Committed |
| `55cb0aa82f80df94fe87a010124591ce7e09d454` | Verify malformed URL input safely | Committed |
| `058f08517ecc0341d197de373f2885077dd41d32` | Verify stateful control outcomes explicitly | Committed; CI pending at last check |
| `04c32395a2e64a08f6ba5758eaa7520b7d618784` | Restrict form invalid-input candidates to supported types | Committed; CI pending at last check |

## CI evidence

- **Previously passed:** [TypeScript validation #28](https://github.com/nareshbabunuli/Design-Review/actions/runs/38074124209) — commit `55cb0aa82f80df94fe87a010124591ce7e09d454`.
- **Passed:** [TypeScript validation #29](https://github.com/nareshbabunuli/Design-Review/actions/runs/38074602041) — commit `058f08517ecc0341d197de373f2885077dd41d32`.
- **Passed:** [TypeScript validation #30](https://github.com/nareshbabunuli/Design-Review/actions/runs/38074606541) — commit `04c32395a2e64a08f6ba5758eaa7520b7d618784`, including the latest form-classification change.
- CI is green for the latest code changes. This is TypeScript validation, not browser/end-to-end verification.
- TypeScript validation is not a browser test and does not prove end-to-end behavior.

## Browser fixture matrix

Run on an isolated local fixture page. Do not submit forms or trigger real external side effects.

| Fixture control | Expected classification | Expected test behavior | Status |
|---|---|---|---|
| `input[type=text]` | `valid_input` (and required validation when required) | Fill synthetic value, verify it is retained, restore original | Not run |
| `input[type=email]` | `valid_input`, `invalid_input`, required if applicable | Test safe sample and malformed email with native validity; restore original | Not run |
| `input[type=url]` | `valid_input`, `invalid_input`, required if applicable | Test safe sample and malformed URL with native validity; restore original | Not run |
| `input[type=search]` | `search` | Require visible result/empty-state change; restore original | Not run |
| `input[type=tel]` | `valid_input` | Use type-appropriate synthetic value; restore original | Not run |
| `input[type=password]` | `valid_input` | Use synthetic value; never log/store the value; restore original | Not run |
| `textarea` | `valid_input`, required if applicable | Fill and restore original | Not run |
| Checkbox | `checkbox`, not `valid_input` | Pass only if checked state changes | Not run |
| Radio | `radio`, not `valid_input` | Pass only if checked/selected state changes | Not run |
| Native select | `dropdown`, not `valid_input` | Inspect options safely; no submit or persistent mutation | Not run |
| Submit button | Submit/form-submit candidate | Must remain blocked unless isolated test-data cleanup is configured | Not run |
| Expand/collapse control | `expand_collapse` | Pass only if expanded state changes | Not run |
| Ordinary button | `button` or semantic action pattern | UI transition alone is only transition evidence, not proof of business success | Not run |

## End-to-end coverage checklist

- [ ] Confirm visible controls are classified correctly and hidden/disabled controls are excluded.
- [ ] Confirm text and specialized inputs use type-appropriate values and originals are restored.
- [ ] Confirm checkbox, radio, toggle, and expand/collapse results rely on the target's state, not unrelated page changes.
- [ ] Test same-origin, external, malformed, and prefix-confusion URLs (e.g. a trusted hostname followed by an attacker-controlled suffix).
- [ ] Test destructive/consequential labels including pay, purchase, refund, transfer, send, publish, deploy, invite, access changes, and password changes; verify all remain blocked.
- [ ] Confirm search only passes when a visible result or empty state is observed.
- [ ] Confirm no real form submission, payment, deletion, publication, email, logout, or external navigation occurs in the fixture.
- [ ] Confirm each pass/fail/blocked result includes a clear observation and is recorded in the Action Ledger.
- [ ] Confirm missed coverage remains queued and the run does not report completion while unresolved coverage remains.
- [ ] Run existing fixture checks for SPA tabs, modal sibling actions, authentication branches, form validation, email/OTP checkpoints, and retry history (see `docs/ACTION_LEDGER_IMPLEMENTATION_CHECKLIST.md`).
- [ ] Check the latest Vercel deployment/build and record its URL/result.

## Findings and follow-up

1. **Do not equate a click with success.** A generic control may only be marked as an observable transition; meaningful business outcomes need a specific assertion.
2. **Search behavior needs an app-specific assertion.** Text changing anywhere on the page may be unrelated; fixture tests should ensure the expected results/empty state is what changed.
3. **Native validity is not server validation.** Email/URL `checkValidity()` tests browser constraints only; it does not prove backend validation.
4. **Synthetic input restoration needs verification.** Confirm framework-controlled inputs retain their original state after restoration and no unwanted autosave/API side effects occur.
5. **Browser/end-to-end tests remain outstanding.** TypeScript checks passed before the latest URL-origin and action-risk commits; confirm their CI and run the fixture matrix.

## Update log

- **2026-10-10:** Recorded input-classification changes, outcome-verification changes, CI runs #29 and #30 passing, URL-origin hardening, consequential-action risk classification, and browser fixture test requirements. Browser tests have not yet been run.
