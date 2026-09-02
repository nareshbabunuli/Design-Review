# 🎨 Design Review

**Free & Open-Source Design Feedback Tool for Freelancers**

Stop endless UI revision loops.  
Compare Figma designs with live screenshots, collect clear client feedback, and get proper sign-offs — all in one place.

[![License: MIT + Commons Clause](https://img.shields.io/badge/License-MIT%20%2B%20Commons%20Clause-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Database-3ecf8e?logo=supabase)](https://supabase.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

### The Problem

As a freelancer, you've probably experienced this:

- Clients keep requesting small UI changes
- Feedback is scattered across email, WhatsApp, Figma comments, and Slack
- No clear record of what was actually approved
- Hard to prove scope when clients say “this isn’t what we agreed”

**Design Review** was built to fix exactly this.

---

### Key Features

- **Side-by-Side Comparison** — Put Figma designs next to live app screenshots with zoom
- **No-Login Client Sharing** — Generate view or edit links (Google Drive style). Clients don’t need an account
- **Structured Feedback** — Clients leave clear, organized comments
- **Designer Reasoning** — Document *why* a change was made (reduces future arguments)
- **Approval Tracking** — Know exactly what is approved and what is still pending
- **Presentation + PDF Reports** — Clean slides and printable reports for client meetings
- **Multi-Project Workspace** — Manage all your clients in one place
- **Light & Dark Mode**

---

### Why This Project Exists

This tool is built **by a freelancer, for freelancers**.  
The goal is simple: make design feedback cleaner, faster, and less painful — without forcing clients to create yet another account.

---

### Tech Stack

- **Next.js 15** (App Router)
- **TypeScript**
- **Tailwind CSS v4**
- **Supabase** (Auth + Database + Realtime)
- **Lucide Icons**

---

### Getting Started

#### Prerequisites
- Node.js 18+
- A free [Supabase](https://supabase.com) account

#### Installation

```bash
git clone https://github.com/nareshbabunuli/Design-Review.git
cd Design-Review
npm install
```

Create a `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Run the SQL migrations from the `supabase/` folder in your Supabase SQL editor, then:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

### Contributing

**Contributors are very welcome.**

Whether you want to:
- Fix a small bug
- Improve the UI
- Add a new feature
- Improve documentation
- Suggest ideas

…you are invited.

👉 Read the [Contributing Guide](CONTRIBUTING.md)  
👉 Check [Good First Issues](https://github.com/nareshbabunuli/Design-Review/labels/good%20first%20issue)

We especially welcome people who have experienced the pain of messy client feedback.

---

### License

MIT License **with Commons Clause**.

**You can:**
- Use it freely for your freelance/client work
- Self-host it
- Fork and modify it
- Contribute

**You cannot:**
- Sell it as a commercial SaaS / white-label product

Full details in the [LICENSE](LICENSE) file.

---

### Support the Project

If this tool helps you, please:

- ⭐ Star the repository
- Share it with other freelancers
- Open issues or feature requests
- Contribute code or ideas

Built with ❤️ for the freelance design community.
