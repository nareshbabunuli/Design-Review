# 🎨 Design Review & Autonomous AI Simulator Engine

> **Open-Source Design Review Platform & Autonomous Web Application Testing Simulator**  
> Streamline UI sign-offs with Figma comparisons, and automate systematic end-to-end application testing using autonomous AI browser agents.

[![License: MIT + Commons Clause](https://img.shields.io/badge/License-MIT%20%2B%20Commons%20Clause-blue.svg)](LICENSE)
[![Author: Naresh Babu Nuli](https://img.shields.io/badge/Author-Naresh%20Babu%20Nuli-orange.svg)](https://github.com/nareshbabunuli)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Database-3ecf8e?logo=supabase)](https://supabase.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

> [!NOTE]
> ### 📜 Open Source with Author Attribution & Anti-SaaS Protection
> This project is free and open source under the **MIT License with Commons Clause & Mandatory Attribution**.  
> - **Free to use & self-host**: You can freely use, run, and self-host this software for yourself, your team, and client engagements.
> - **Author credit required**: Any public deployment or fork must include visible, clickable attribution:  
>   *"Powered by Design Review & AI Simulator by [Naresh Babu Nuli](https://github.com/nareshbabunuli/Design-Review)"*.
> - **Anti-SaaS Clause**: You may **not** take this codebase, rebrand it, and sell it as a commercial SaaS product or paid service to third parties.

---

## ⚡ What is Design Review & AI Simulator?

This repository combines two core engineering solutions:

1. **Autonomous AI Testing Simulator** — A QA engine that systematically audits, maps, plans, and executes deep browser interactions on live web applications with visual proof.
2. **Design Review Platform** — A side-by-side design comparison and client approval workspace connecting Figma mockups with real production screens.

---

## 🤖 Pillar 1: Autonomous AI Testing Simulator

Traditional automated testing breaks when selectors change or auth redirects occur. The AI Simulator operates through two specialized testing paradigms:

### 1️⃣ Mode 1: Full App Systematic Testing (MAP & PLAN FIRST)
- **Automatic Screen Discovery**: Crawls reachable web pages, inspects Single Page Application (SPA) state tabs (`[role="tab"]`, `.tab`, nav triggers), and extracts complete actionable element inventories (inputs, dropdowns, toggles, file uploads, action buttons).
- **Figma-Style Visual Workflow Canvas**: Diagrams discovered screens, routes, and modal transitions into an interactive visual graph.
- **Pre-Flight Test Plan**: Automatically formulates structured test cases with synthetic test data before execution begins.
- **Systematic Step Execution**: Executes every action step-by-step with fault-tolerant multi-tier locators (CSS IDs, testids, aria labels, and semantic fuzzy text matching).
- **Dynamic New Discovery**: Automatically detects modals, drawers, or unmapped routes that open mid-test and dynamically inserts them into the test suite.
- **Visual Evidence & Reports**: Captures high-resolution screenshot proofs on every step with passing/failing verdicts and coverage metrics.

### 2️⃣ Mode 2: Targeted Feature / Workflow Testing
- **Natural Language Prompts**: Simply specify what to test: *"Test invoice creation flow"*, *"Test user signup and file upload"*, or *"Test forgot password and reset"*.
- **Autonomous Intent Decomposition**: The engine identifies starting points, goal criteria, required screens, and synthetic data needs without asking for code selectors.
- **Targeted Discovery**: Focuses crawling exclusively on the relevant user journey.
- **Edge Case Validation**: Automatically tests missing required fields, boundary values, invalid email formats, and unexpected UI states.

### 🛡️ Smart Autonomous Capabilities
- **Interactive Login Wall Detection**: Pauses automatically when encountering password fields, securely prompts for test credentials with persistence, logs in via Puppeteer, and transitions seamlessly to post-auth application mapping.
- **Single Page Application (SPA) Navigation**: Seamlessly explores complex React/Next.js single-page dashboards driven by state variables and tabs rather than URL changes.
- **Dummy File Generation**: Synthesizes in-memory images, PDFs, CSVs, and documents on the fly to test file upload controls.

---

## 🎨 Pillar 2: Design Review & Client Sign-off

Built specifically to stop endless revision loops and misaligned client expectations:

- **Side-by-Side Comparison** — Compare Figma frames directly against live application screenshots with interactive zoom and split sliders.
- **No-Login Client Sharing** — Share secure review links (Google Drive style). Clients leave structured feedback without creating an account.
- **Structured Feedback & Annotations** — Pin comments directly to specific UI regions.
- **Designer Reasoning Log** — Document *why* design decisions were made to prevent scope creep.
- **Approval Tracking** — Track approved vs pending screens in real time.
- **Client Presentation Slides & PDF Export** — Generate clean pitch decks and sign-off reports with a single click.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS & Lucide Icons
- **Browser Automation**: Puppeteer & Headless Chrome
- **Database & Auth**: Supabase (PostgreSQL + Row-Level Security)
- **AI Integrations**: Vision & LLM-driven prompt orchestrations

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or pnpm
- A free [Supabase](https://supabase.com) project

### Installation

```bash
git clone https://github.com/nareshbabunuli/Design-Review.git
cd Design-Review
npm install
```

Configure `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
# Optional AI provider keys:
OPENROUTER_API_KEY=your_openrouter_api_key
```

Run database migrations from `supabase/` in your Supabase SQL editor, then launch development:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (Design Review) and [http://localhost:3000/ai-simulator](http://localhost:3000/ai-simulator) (AI Simulator Cockpit).

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## ⚖️ License

Copyright (c) 2026 **Naresh Babu Nuli**.  
Licensed under the **MIT License with Commons Clause & Mandatory Attribution Condition**.

- ✅ Free for personal use, internal team workflows, and client work.
- ⚠️ Public deployments and forks must visibly credit the author: *"Powered by Design Review & AI Simulator by Naresh Babu Nuli"*.
- ❌ Reselling as a standalone commercial SaaS or white-label service is strictly prohibited without written consent.

See [LICENSE](LICENSE) for full details. For custom commercial licensing, reach out to [nareshbabu.nuli@gmail.com](mailto:nareshbabu.nuli@gmail.com).
