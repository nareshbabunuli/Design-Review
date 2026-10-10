# Action Ledger Implementation Checklist

## Scope and UI constraints

- [x] Keep the ledger inside the existing AI Simulator execution view.
- [x] Extract the ledger into a reusable `ActionLedgerPanel` component.
- [x] Avoid adding a second page or duplicate application shell.
- [x] Provide Live, Queue, and History views with status counts.

## Discovery and queue behavior

- [x] Give each action a stable identity scoped to its discovered screen.
- [x] Build executable steps for discovered controls that are not already represented in the plan.
- [x] Rescan the current DOM after every executed action, even when the route is already known.
- [x] Merge new controls and forms into existing screen records rather than replacing the inventory.
- [x] Prioritize pending actions for the current screen so tab controls are tested together.
- [x] Restore discovered SPA tabs before testing their child controls.
- [x] Put common dismiss/close controls after sibling modal actions where possible.
- [x] Stop the run from claiming completion when ledger actions or plan steps remain unresolved.

## Evidence and data handling

- [x] Record the final outcome, status, attempt count, and timestamp for each action.
- [x] Retain up to 20 resolved outcomes per action across retries.
- [x] Attach the final screenshot to the ledger entry and expose it in the existing screenshot viewer.
- [x] Redact registered secrets from action results, console messages, network URLs, headers, and request bodies.
- [x] Avoid showing sensitive field values in action banners and stored outcomes.
- [x] Prefer valid, visible, non-sensitive values already present in a form; explicit Postman mappings and supplied sandbox payment details take precedence.

## Required validation before merge

- [ ] Confirm the latest Vercel deployment succeeds and inspect the first build error if it fails.
- [ ] Run a full TypeScript/build check in the repository environment.
- [ ] Test a fixture app where a tab reveals additional controls without changing the URL.
- [ ] Test a modal that reveals controls and verify sibling actions run before the modal is dismissed.
- [ ] Test a route with Login, Sign Up, and Forgot Password branches and verify no branch disappears from the queue.
- [ ] Test a form with prefilled data, missing data, invalid email, and valid submission.
- [ ] Test an email/OTP checkpoint and verify the run pauses, resumes, and records the confirmation.
- [ ] Confirm the History view preserves previous outcomes after a failed action is retried.
- [ ] Confirm the run never reports full coverage while any discovered action is still untested.

## Merge rule

Do not merge this branch until the build check and the fixture-app coverage checks above are complete. A discovered action is not considered tested merely because its screen was mapped.
