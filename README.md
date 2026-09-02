# 🎨 Design Review — Design Workflow Tracker

> **Free & Open-Source Design Review Workflow Tracker for Freelancers & Teams.**

![Design Review Banner](https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&h=400&q=80)

[![License: MIT + Commons Clause](https://img.shields.io/badge/License-MIT%20%2B%20Commons%20Clause-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15%2B-black?logo=next.js)](https://nextjs.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Database-3ecf8e?logo=supabase)](https://supabase.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)

---

## 💡 About The Project

Freelance designers often face repetitive hurdles when sharing work with clients:
- Endless email attachments and lost feedback
- Unclear version comparisons between Figma mockups and real app builds
- Chasing approvals across chat apps and threads
- Awkward client onboarding processes

**Design Review** solves this by providing a dedicated, elegant comparison and workflow tracker designed specifically for freelancers. Upload your Figma designs and live app screenshots side-by-side, add designer notes and change justifications, generate instant view-only or edit invite links for clients without login hurdles, collect real-time verification, and export clean presentation reports.

---

## ✨ Key Features

- 📁 **Multi-Project Workspace**: Manage all client projects in one unified dashboard with grid or list view and quick search.
- 🔄 **Side-by-Side Comparison**: Compare Figma designs against live app screenshots with high-res zoom lightbox.
- 🔗 **Google Drive-Style Client Sharing**: Generate instant view-only or edit invite links. Clients don't need an account to review and comment.
- 💬 **Collaborative Review & Feedback**: Clients leave structured feedback per workflow stage with real-time sync.
- 📝 **Developer / Designer Reasoning Form**: Document the "why" behind changes directly alongside feedback.
- ✅ **Acceptance & Verification Tracking**: Built-in status tracking to ensure client sign-off on individual workflows.
- 📊 **Presentation & PDF Report Mode**: Full-screen slide-based presentation view, ready for client meetings and clean A4 print exports.
- 🌓 **Dual Light & Dark Themes**: Fully tailored dark and light modes with instant switching and persistence across all screens.

---

## 📜 License & Open Source Terms

This project is licensed under the **MIT License with Commons Clause** ([LICENSE](LICENSE)).

### 🟢 What You CAN Do:
- **Free for Client Work**: Use this software freely for your own freelance or agency projects.
- **Self-Host**: Deploy your own instance for yourself or your design team.
- **Fork & Modify**: Customize the code, add new features, and tailor it to your workflow.
- **Contribute**: Submit pull requests, report issues, and improve the project for everyone.

### 🔴 What You CANNOT Do:
- **No Reselling**: You cannot package, white-label, or sell this software as a commercial SaaS product or service.
- **Attribution Required**: You must retain the original copyright notice and license in all forks and deployments.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ or 20+
- npm, pnpm, or yarn
- Supabase account (free tier works great)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/design-workflow-tracker.git
   cd design-workflow-tracker
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up Environment Variables**:
   Create a `.env.local` file in the root directory:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Run the Database Migrations**:
   Execute the SQL schema in your Supabase SQL editor (located in `supabase/` folder).

5. **Start the Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router & React Server Components)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Database & Auth**: [Supabase](https://supabase.com/) (PostgreSQL + Real-time Channels)
- **Language**: [TypeScript](https://www.typescriptlang.org/)

---

## 🤝 Contributing

Contributions from the freelance and design community are welcomed!
1. Fork the repo
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 💖 Community & Support

Built with love to empower freelance designers worldwide. If you find this project helpful, give it a ⭐️ on GitHub!
