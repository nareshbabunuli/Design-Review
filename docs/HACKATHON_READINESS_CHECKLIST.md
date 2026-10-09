# Open Design AI — Three-Hackathon Readiness Checklist

Repository: https://github.com/nareshbabunuli/Design-Review  
Prepared: 2026-10-09  
Goal: prepare one shared autonomous testing core and three honest, competition-specific entries.

> This checklist is a plan, not a claim of eligibility, completed work, passing tests, or guaranteed prize outcomes. Check official rules again before submitting because organisers can update them.

## Current repo facts verified on 2026-10-09

- [x] Public repository exists: `nareshbabunuli/Design-Review`, default branch `main`.
- [x] README describes full-app map-and-plan testing, targeted workflow testing, screenshots/evidence, visual workflow canvas, SPA interaction, login-wall handling and dummy file generation.
- [x] Recent commits on 2026-10-09 include visible human-paced login, human mouse journey navigation, URL recording, and navigation/login-success verification.
- [x] Current LICENSE is **MIT with Commons Clause and mandatory attribution**. This is not plain MIT. Do not describe it as an unmodified MIT licence.
- [ ] Check current CI workflows, build status, and actual test coverage. Do not assume these pass simply because code was pushed.
- [ ] Make a dated record of which new changes were implemented for each event. Do not retroactively describe earlier work as hackathon-built.

## Shared product work (used across all three)

### Demo path
- [ ] Choose one target application that we own or have explicit permission to test.
- [ ] Prepare a deterministic user journey with safe synthetic data.
- [ ] Demonstrate **MAP → PLAN → EXECUTE → VERIFY → REPORT** in one recording.
- [ ] Show the discovered screens, tabs, modals, controls, and navigation edges.
- [ ] Show a real defect or controlled failure and prove how visual/log evidence changes the agent’s next action.
- [ ] Demonstrate an authentication/email-confirmation handoff: pause, ask a human to confirm, safely resume, and verify success.
- [ ] Keep secret credentials, tokens, customer data, and session cookies out of recordings, logs, and committed fixtures.
- [ ] Capture screenshots/video at each meaningful test step and link each issue to reproducible evidence.
- [ ] Add timeout/retry limits, allowed-domain boundaries, destructive-action safeguards, and a safe stop condition.
- [ ] Run clean install, lint/type-check where configured, production build, and repeatable end-to-end smoke test.
- [ ] Publish setup steps, architecture diagram, limitations, security model, test dataset and reproducible evaluation metrics.
- [ ] Record baseline and final metrics: screen coverage, action/edge coverage, defect precision/recall where labels exist, false positives, test pass rate, run duration and recovery rate.
- [ ] Produce one stable deployment and freeze a tagged candidate commit before recording demos.

## 1. OpenCV AI Competition

Official pages: https://opencv26.devpost.com/ and https://opencv26.devpost.com/rules

### Eligibility / rule gates
- [ ] Re-read current rules and confirm account, team, location, deadline and allowed project dates.
- [ ] Use OpenCV 5 for substantive computer-vision work; capture the exact package/version and document which code calls it.
- [ ] Deploy a meaningful component on AWS and document the AWS service(s), architecture and operating path.
- [ ] Confirm the chosen award/track and any additional track-specific criteria.
- [ ] Verify repository access for judges (public or private as rules allow).
- [ ] Provide requested technical report, architecture, evaluation, limitations and responsible-use notes.
- [ ] Prepare a working endpoint or judge-accessible live demo, as permitted by the rules.
- [ ] Keep the demo video within the event’s five-minute maximum.
- [ ] Reconfirm exact deadline and timezone on Devpost before submission.

### What to build for this competition
- [ ] Add screenshot comparison / visual-region analysis using OpenCV 5 (not only an LLM screenshot description).
- [ ] Detect and report visual anomalies such as blank/missing regions, unexpected layout shifts, overlays, clipping, and baseline differences.
- [ ] Include viewport/device-size comparison with controlled browser settings.
- [ ] Implement an **agentic vision loop**: visual finding → explicit decision → changed next action or safe human handoff → re-observation.
- [ ] Store baseline/current screenshots, region diffs, thresholds, and explanation for each finding.
- [ ] Evaluate on a labelled set of positive and negative examples; report false positives and misses.
- [ ] Add tests for image scaling, viewport variance, animation/flaky content and dynamic text so changes aren't over-reported.
- [ ] Write the technical report and include one limitation/failure case.
- [ ] Record a ≤5-minute video showing baseline, introduced defect, OpenCV evidence, changed agent action, and final report.

### Submission package
- [ ] Project title and concise problem/impact statement.
- [ ] Public/private judge-accessible code repo with install/run steps.
- [ ] Architecture diagram showing OpenCV 5, AWS, browser runner, agent controller and evidence storage.
- [ ] Evaluation results and reproducible commands.
- [ ] Working deployment or approved live demo method.
- [ ] Video, technical report, limitations and responsible-use considerations.

## 2. Life After Code — GitLab Transcend

Official pages: https://gitlab-transcend.devpost.com/ and https://gitlab-transcend.devpost.com/rules

### Critical licence blocker
- [ ] **Do not assume current repo qualifies for Path B.** Current LICENSE includes Commons Clause and mandatory attribution; the organiser's Path B requirement, as currently understood, is an MIT-licensed existing project.
- [ ] Re-read the official rules and ask the organiser whether this custom licence is accepted before choosing Path B.
- [ ] Do not replace the licence or claim plain MIT without a deliberate, rights-cleared decision; confirm all contributors/dependencies and your intent first.
- [ ] If Path B cannot be confirmed, assess Path A and its new-project/new-CI requirements. Do not simply relabel the existing app as new.
- [ ] Confirm the published deadline, submission window and all new-work dates against the official rules.

### Required integration and evidence
- [ ] Verify access to GitLab Duo Agent Platform (agent/flow/MCP capability used by the event) and document the actual features used.
- [ ] Create the GitLab project and ensure its licence/visibility meet the chosen path.
- [ ] Build an end-to-end workflow triggered by a code change or merge request.
- [ ] Have the agent run a test, collect screenshots/logs, summarise the failure and create a reproducible issue or suggested patch.
- [ ] Add a bounded remediation loop: suggested change → explicit approval where appropriate → CI rerun → evidence of the result.
- [ ] Deploy a working Path B demo and keep it available for the required judging period, if choosing Path B.
- [ ] Preserve visible CI/CD pipeline history and pipeline configuration.
- [ ] Document exactly which work was created during the eligible period.
- [ ] Record a public YouTube demo under three minutes (verify current cap).
- [ ] Show a full trigger-to-result run, the GitLab Duo component, pipeline history, and a failure/decision point.

### Submission package
- [ ] Path-specific project description.
- [ ] Repository and licence clearly visible.
- [ ] Agent/flow configuration and explanation of GitLab Duo integration.
- [ ] CI/CD pipeline evidence.
- [ ] Working deployment where required.
- [ ] Public video under the current limit.
- [ ] All rules/date/eligibility checks re-confirmed.

## 3. Nebius x NVIDIA Global AI Hackathon

Official pages: https://nebiusglobalaihackathon.devpost.com/ and https://nebiusglobalaihackathon.devpost.com/details/faqs

### Eligibility / rule gates
- [ ] Re-read latest official rules/FAQ; confirm participant eligibility, submission window and selected track.
- [ ] Provision a supported Nebius Token Factory or Nebius AI Cloud deployment.
- [ ] Integrate at least one qualifying NVIDIA open-source model; verify model and licence eligibility from official sources.
- [ ] Publicly publish code with a licence accepted by the rules.
- [ ] Document setup and include a working demo URL.
- [ ] Record a public YouTube demo no longer than three minutes.
- [ ] Keep credentials and inference keys on the server; never expose them to client bundles or commits.
- [ ] Document model calls and Nebius services so the integrations are substantive and reproducible.
- [ ] Identify what changed during the hackathon period and retain dated commits/evidence.
- [ ] Provide concrete developer feedback on Nebius/NVIDIA tools as required.
- [ ] Confirm current deadline and time zone on Devpost before submission.

### What to build for this competition
- [ ] Use the NVIDIA model for a clearly defined role: test planning, failure triage, action selection, or recovery reasoning.
- [ ] Keep browser automation and deterministic assertions separate from model reasoning; don't claim the model performed deterministic checks it didn't perform.
- [ ] Make the planner produce structured, validated test steps with expected outcomes and bounded action limits.
- [ ] Use browser observations/screenshots/errors as tool results and show how those results change the next action.
- [ ] Implement human approval pauses for email confirmation, authentication, sensitive or destructive actions, then safely resume.
- [ ] Add error handling for provider timeouts, malformed model output, rate limits and fallback/unavailable model state.
- [ ] Record latency, token/call cost if available, task success, screen/action coverage, recovery rate and unsafe-action prevention.
- [ ] Build and test a clean deployment on Nebius.
- [ ] Record the ≤3-minute video showing the NVIDIA model and Nebius deployment in the real end-to-end workflow.

### Submission package
- [ ] Public repo with accepted open-source licence and reproducible README.
- [ ] Public working demo.
- [ ] Clear NVIDIA model + Nebius service architecture.
- [ ] Dated evidence of significant new work.
- [ ] Short video under the event's current limit.
- [ ] Required platform feedback and track selection.

## Cross-competition release gates — no submission until green
- [ ] Current rules rechecked on official pages, including project start dates, deadline timezone and required integrations.
- [ ] No unsupported performance claims; all metrics reproducible from included commands/data.
- [ ] Demo deployed, fresh-browser-tested, and working without the developer's local machine.
- [ ] All public pages and videos avoid exposed secrets, real customer data and unapproved target applications.
- [ ] README says exactly how to configure providers, run a test, access evidence, and troubleshoot.
- [ ] The demo displays a complete successful run and a controlled failure/recovery run.
- [ ] Repository licences and third-party assets/model licences are compatible with each submission.
- [ ] Video audio/captions, public permissions, length, repo URL and demo URL checked.
- [ ] Every required submission form field completed and confirmation receipt saved.

## Known risks right now

1. **GitLab Path B licence is unresolved.** The repository's current licence is MIT + Commons Clause + mandatory attribution, not plain MIT. Obtain written organiser confirmation or take a compliant alternative path.
2. **OpenCV 5/AWS integration is not yet verified.** The README alone does not prove OpenCV 5 is in the dependency tree or substantively used, nor that the app is running on AWS.
3. **Nebius/NVIDIA integration is not yet verified.** Current README lists multiple generic AI providers, but does not prove a supported NVIDIA open-source model is used through Nebius.
4. **Build and test status are unknown.** Run the commands and retain logs before claiming readiness.
5. **Winning cannot be guaranteed.** This checklist targets rule compliance, a credible technical demo, measurable results and evidence; final outcomes depend on judges and competing entries.

## Suggested submission story

"Open Design AI doesn't just click through pages. It maps an application, plans tests before execution, observes real browser and visual evidence, detects problems, and changes its next action or pauses for human approval. Every finding is reproducible and tied to screenshots, logs, and a coverage report."

Use the same true product story, but make each submission distinct:
- OpenCV: measured visual detection and evidence-driven perception/action.
- GitLab: code-change-to-test-to-remediation CI/CD workflow.
- Nebius: NVIDIA-model-powered planning/recovery deployed on Nebius.

## Daily status log

| Date | Change / evidence | Commit or artifact | Verified by |
|---|---|---|---|
| 2026-10-09 | Recent commits address visible human-paced login, whole-journey mouse navigation, and URL/login verification. | See repository commit history | GitHub main branch reviewed |
| | | | |
