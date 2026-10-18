# Open Design AI

> **Find bugs in your web app. See the evidence. Understand what to fix.**
>
> Open Design AI is an open-source web application testing and design review platform. It explores web interfaces, plans and runs browser tests, captures screenshots, and produces reports that help developers understand what worked and what failed.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Repository:** [nareshbabunuli/Design-Review](https://github.com/nareshbabunuli/Design-Review)

---

## See what it does

### Autonomous web app testing
![AI Testing](public/screenshots/tests.png)

Explore reachable screens, build a structured test plan, execute browser interactions, and collect screenshot evidence and pass/fail results.

### Map screens and user journeys
![Flow Canvas](public/screenshots/figma.png)

Visualize discovered screens and navigation paths in a flow canvas to help understand what the crawler found.

### Review coverage and findings
![Coverage Report](public/screenshots/analysis.png)

Review screen and action coverage, detected issues, and test evidence in a consolidated report.

### Compare designs with the live app
![Simulator Preview](public/screenshots/simulator-preview.png)

Compare Figma designs with live web pages in responsive device frames. Use the review workspace for feedback, annotations, and approvals.

> Screenshots show the product interface. Actual discovery and test results depend on the target app, access permissions, test configuration, and AI provider.

---

## Why Open Design AI?

Testing a web app is more than checking whether a page loads. Important behavior often lives inside tabs, menus, dialogs, forms, and multi-step journeys.

Open Design AI is designed to help developers and teams:

- **Discover** reachable screens and interactive UI elements.
- **Plan before execution** with a structured test plan.
- **Exercise workflows** using browser automation and resilient element locators.
- **Capture evidence** with screenshots, execution steps, and pass/fail results.
- **Inspect coverage** through a visual screen-flow map and test reports.
- **Review design differences** by comparing a Figma frame with a live page.
- **Connect optional integrations** for workflows such as GitLab Duo-assisted fixes.

Open Design AI aims to make application testing easier to inspect and review. Automated results are evidence to investigate, not a guarantee that every bug has been found.

## How it works

1. **Choose a target web app** and configure access if it requires authentication.
2. **Discover the interface** by exploring reachable pages and UI states.
3. **Review the test plan** generated for the discovered application.
4. **Run the tests** and collect browser execution evidence.
5. **Inspect the report** for failures, coverage, screenshots, and follow-up work.

A crawl can only reach states permitted by the target app, available credentials, and the configured browser environment. Review test actions carefully when working with production systems or data.

---

## Core capabilities

### Full-app discovery and testing
- Crawls reachable pages and inspects common single-page application navigation patterns.
- Inventories actionable controls such as inputs, buttons, dropdowns, and toggles.
- Builds a structured test plan before execution.
- Executes steps using multiple locator strategies, including IDs, test IDs, accessibility labels, and semantic text matching.
- Detects some newly revealed dialogs, drawers, and routes during execution.

### Targeted workflow testing
Describe a journey to test, such as:
- “Test the user sign-up and profile creation flow.”
- “Test invoice creation.”
- “Test password reset and validation errors.”

The engine uses the prompt to plan a focused workflow. Results depend on the target application's behavior and available test access.

### Evidence and reports
- Browser screenshots and step-by-step execution results.
- Pass/fail summaries and coverage information.
- UX audit findings based on observable interface behavior.
- HTML reports that can be viewed in a browser or printed to PDF.
- ZIP export options for sharing reports and supporting evidence.

### Design review and approvals
- Side-by-side Figma and live-page comparison.
- Responsive device previews.
- Feedback and annotations for review.
- Approval tracking and presentation-ready exports.
- Shareable review links where configured.

### Optional integrations
The core testing workflow and the connected services have different setup requirements. Figma and GitLab connections are optional integrations; they are not substitutes for configuring the app's required runtime services. GitLab Duo availability also depends on the GitLab account, project permissions, and Duo access.

---

## Quick start

### Requirements
- Node.js 18 or newer (a version supported by the project's dependencies is recommended).
- npm or pnpm.
- A Supabase project for the application's database and authentication.
- An AI provider/API key for AI-powered testing, or a compatible local inference server.

### 1. Clone the repository

```bash
git clone https://github.com/nareshbabunuli/Design-Review.git
cd Design-Review
npm install
```

### 2. Configure environment variables

Create a `.env.local` file in the project root. Use your own project credentials; do not commit secrets.

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# AI provider example: Nebius Token Factory
AI_PROVIDER=nebius
AI_BASE_URL=https://api.tokenfactory.nebius.com/v1
NEBIUS_API_KEY=your_nebius_api_key
AI_MODEL=nvidia/Nemotron-3-Nano-Omni
```

Use the environment variable names and model identifiers supported by your checked-out configuration. For other providers or local inference, see the provider configuration in the project and the relevant provider's current documentation.

### 3. Set up the database

Apply the SQL migrations in `supabase/` to your Supabase project using the project's documented migration workflow or SQL editor.

### 4. Start the development server

```bash
npm run dev
```

Open:
- Main application: [http://localhost:3000](http://localhost:3000)
- AI Simulator: [http://localhost:3000/ai-simulator](http://localhost:3000/ai-simulator)

### 5. Run a test

Open the AI Simulator, enter the target application's URL, configure any required access and test options, and launch a test. Review the generated plan and results. For local development, run the target app on a separate port from Open Design AI.

For additional setup guidance for file-upload test fixtures, see [TESTING_SETUP_PROMPT.md](TESTING_SETUP_PROMPT.md).

---

## AI provider configuration

Open Design AI uses a configurable AI provider for AI-assisted testing. Availability, model names, rate limits, and costs vary by provider and account.

Example configuration for a compatible local inference server:

```env
AI_PROVIDER=local
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=llama3.2
```

Install and start [Ollama](https://ollama.com/) separately, then pull a model supported by your machine. Local inference avoids sending prompts to a hosted inference provider, but the app may still contact other configured services such as Supabase or the target website.

For a hosted provider, configure the base URL, model identifier, and API key required by that provider. Never put secret API keys in client-side code or commit them to Git.

---

## Reports and exports

Depending on the completed test run and enabled features, reports can include:

- Executive summary and test statistics.
- Screens and actions discovered.
- Step-by-step execution results and screenshots.
- Detected issues grouped by severity.
- Coverage and UX audit observations.
- Execution logs and workflow details.

Reports describe what the automation observed. Coverage percentages and automated UX scores should be interpreted in context; they do not replace manual QA, accessibility testing, security testing, or feedback from real users.

---

## Technology

- **Application:** Next.js App Router, React, TypeScript, Tailwind CSS.
- **Browser automation:** Puppeteer and Browserbase Stagehand.
- **Database and authentication:** Supabase / PostgreSQL with row-level security.
- **AI inference:** Configurable hosted or local OpenAI-compatible providers.
- **Design review:** Figma-to-live comparison and review workflows.

---

## Contributing

Contributions, bug reports, and practical feedback are welcome.

1. Open an issue describing the problem or proposed improvement.
2. Fork the repository and create a focused feature branch.
3. Add or update tests where appropriate.
4. Run the relevant checks before opening a pull request.
5. Explain the change and include screenshots or logs when they help reviewers.

Please avoid submitting secrets, private customer data, or screenshots containing sensitive information.

## License

Open Design AI is licensed under the [MIT License](LICENSE). See the license file for the full terms.

---

## Research foundation

The project's UX audit framework draws on established human-computer interaction and usability research, including heuristic evaluation, cognitive walkthroughs, ISO 9241-11, WCAG 2.2, the HEART framework, and validated usability questionnaires such as SUS and UMUX-LITE.

Automated interface observations are not the same as measuring perceived user experience with actual users. Scores should be treated as structured indicators for investigation, not as proof of user satisfaction.

Further reading:
- [Nielsen and Molich: Heuristic evaluation of user interfaces](https://doi.org/10.1145/97243.97281)
- [ISO 9241-11: Usability — definitions and concepts](https://www.iso.org/standard/63500.html)
- [W3C WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [Google Research: Measuring the User Experience on a Large Scale](https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/)
