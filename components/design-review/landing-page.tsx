"use client"

import React, { useEffect, useRef, useState } from "react"
import {
  FolderKanban,
  ArrowRight,
  Layers,
  Share2,
  MessageSquare,
  FileText,
  Eye,
  CheckCircle,
  Users,
  Sparkles,
  Zap,
  Shield,
  Star,
  Play,
  ChevronDown,
  Lock,
  Code2,
  Globe,
  Smartphone,
  Monitor,
  Laptop,
  Send,
  Maximize2,
  X,
} from "lucide-react"
import { ThemeToggle } from "./theme-toggle"

function GithubIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
        clipRule="evenodd"
      />
    </svg>
  )
}

interface LandingPageProps {
  onGetStarted: () => void
  theme?: "light" | "dark"
  onToggleTheme?: () => void
}

const PRODUCT_PREVIEWS = [
  {
    id: "simulator",
    title: "Device Simulator",
    badge: "Figma vs Live Frame",
    url: "designhub.app/simulator",
    src: "/screenshots/simulator-preview.png",
    alt: "Device simulator with live URL on phone frame side-by-side with Figma spec",
    description: "Run live web URLs in responsive device frames side-by-side with your Figma design specs. Includes Side-by-Side, Overlay, and Difference modes.",
    icon: Smartphone,
    color: "blue",
  },
  {
    id: "editor",
    title: "Workflow Editor",
    badge: "Figma & App Screenshots",
    url: "designhub.app/editor/screen-1",
    src: "/screenshots/editor-preview.png",
    alt: "Workflow editor showing Figma design upload, app screenshot, developer notes, and client message",
    description: "Upload Figma exports, paste app screenshots, provide developer notes, and manage screen approval states.",
    icon: Layers,
    color: "purple",
  },
  {
    id: "revisions",
    title: "Notes & Revisions",
    badge: "Developer Explanations",
    url: "designhub.app/revisions",
    src: "/screenshots/revisions-preview.png",
    alt: "Developer notes and mandatory revision explanation for client feedback",
    description: "Submit developer notes, read client feedback, and document mandatory reasons for final revisions.",
    icon: MessageSquare,
    color: "amber",
  },
  {
    id: "dashboard",
    title: "Project Dashboard",
    badge: "Multi-Project Management",
    url: "designhub.app/dashboard",
    src: "/screenshots/dashboard-preview.png",
    alt: "Project dashboard showing active projects and access control",
    description: "Organize client projects, track completion progress, manage team access, and launch presentation reports.",
    icon: FolderKanban,
    color: "emerald",
  },
]

const FEATURES = [
  {
    icon: Smartphone,
    color: "blue",
    title: "Interactive Device Simulator",
    description:
      "Test live URLs & responsive screens inside Phone, Tablet, and Desktop frames side-by-side with your Figma specs.",
  },
  {
    icon: Users,
    color: "purple",
    title: "Developer & Client Collaboration",
    description:
      "Developers add designs, simulator previews, and developer notes. Clients inspect, test, and provide direct feedback.",
  },
  {
    icon: MessageSquare,
    color: "violet",
    title: "Client Feedback & Notes",
    description:
      "Structured client messages and developer notes right on the screen. No endless email threads or lost comments.",
  },
  {
    icon: Eye,
    color: "cyan",
    title: "Side-by-Side Spec Comparison",
    description:
      "Compare Figma designs directly against live app frames or screenshots with Side-by-Side, Overlay, and Difference modes.",
  },
  {
    icon: CheckCircle,
    color: "emerald",
    title: "1-Click Accept & Verify",
    description:
      "Clients verify and approve workflows with a single click. Track completed screens and export presentation reports.",
  },
  {
    icon: Share2,
    color: "indigo",
    title: "Zero-Friction Client Sharing",
    description:
      "Generate secure invite links with custom view, comment, or edit permissions. No client login required.",
  },
]

const STEPS = [
  {
    step: "01",
    title: "Import Designs & Live URLs",
    description:
      "Upload Figma designs, app screenshots, and set live app URLs to preview inside responsive simulator frames.",
    icon: Smartphone,
    color: "blue",
  },
  {
    step: "02",
    title: "Add Developer Notes",
    description:
      "Detail design structure, technical constraints, and revision reasons so clients understand every change.",
    icon: Layers,
    color: "purple",
  },
  {
    step: "03",
    title: "Share With Your Client",
    description:
      "Generate a secure link. Clients test the live simulator frame, leave feedback messages, and review notes.",
    icon: MessageSquare,
    color: "violet",
  },
  {
    step: "04",
    title: "Accept & Verify",
    description:
      "Clients approve workflows with 1-click verification. Track completed tasks and export polished reports.",
    icon: CheckCircle,
    color: "emerald",
  },
]

const colorMap: Record<string, string> = {
  blue: "from-blue-500 to-blue-600 shadow-blue-500/30",
  purple: "from-purple-500 to-purple-600 shadow-purple-500/30",
  violet: "from-violet-500 to-violet-600 shadow-violet-500/30",
  indigo: "from-indigo-500 to-indigo-600 shadow-indigo-500/30",
  cyan: "from-cyan-500 to-cyan-600 shadow-cyan-500/30",
  emerald: "from-emerald-500 to-emerald-600 shadow-emerald-500/30",
  amber: "from-amber-500 to-amber-600 shadow-amber-500/30",
}

const bgPillMap: Record<string, string> = {
  blue: "bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300",
  purple: "bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300",
  violet: "bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300",
  indigo: "bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300",
  cyan: "bg-cyan-100 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300",
  emerald: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300",
}

export function LandingPage({ onGetStarted, theme = "dark", onToggleTheme }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false)
  const [previewTab, setPreviewTab] = useState<string>("simulator")
  const [lightboxImg, setLightboxImg] = useState<{ src: string; title: string; desc?: string } | null>(null)
  const heroRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0f] text-slate-900 dark:text-white overflow-x-hidden overflow-y-auto transition-colors duration-300">

      {/* Ambient background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full bg-blue-500/10 dark:bg-blue-500/5 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 h-[500px] w-[500px] rounded-full bg-purple-500/10 dark:bg-purple-500/5 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-violet-500/10 dark:bg-violet-500/5 blur-[120px]" />
      </div>

      {/* ─── NAVBAR ─── */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled
            ? "bg-white/80 dark:bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/5 shadow-sm"
            : "bg-transparent"
          }`}
      >
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-lg shadow-blue-500/30">
              <FolderKanban className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-900 dark:text-white tracking-tight block leading-tight">
                Design Review
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">For Freelancers</span>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <a href="#features" className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
              How it works
            </a>
            <a href="#open-source" className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
              Open Source
            </a>
            <a
              href="https://github.com/nareshbabunuli/Design-Review"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <GithubIcon className="h-4 w-4" />
              <span>GitHub</span>
            </a>
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            <ThemeToggle theme={theme} onToggle={onToggleTheme ?? (() => { })} />
            <button
              onClick={onGetStarted}
              className="hidden sm:flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all active:scale-95"
            >
              Get Started <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ─── HERO ─── */}
      <section ref={heroRef} className="relative pt-28 pb-20 px-6">
        <div className="mx-auto max-w-5xl text-center">

          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 dark:border-blue-800/60 bg-blue-50 dark:bg-blue-950/30 px-4 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 mb-8">
            <Sparkles className="h-3.5 w-3.5 text-blue-500" />
            <span>Interactive Device Simulator &middot; Developer &amp; Client Review</span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl font-black tracking-tight text-slate-900 dark:text-white leading-[1.05] mb-6">
            Design Review with{" "}
            <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-violet-600 bg-clip-text text-transparent">
              Live Device Simulator
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg md:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed mb-10">
            Test live preview URLs in responsive device frames, compare against Figma specs side-by-side,
            and collaborate with clients through structured developer notes and 1-click approvals.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <button
              onClick={onGetStarted}
              className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 px-8 py-4 text-base font-bold text-white shadow-2xl shadow-blue-500/40 transition-all hover:-translate-y-0.5 active:scale-95"
            >
              <Play className="h-4 w-4" />
              Start Free — No Credit Card
            </button>
            <a
              href="https://github.com/nareshbabunuli/Design-Review"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-2xl border border-slate-300 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 px-8 py-4 text-base font-semibold text-slate-700 dark:text-slate-300 transition-all hover:-translate-y-0.5 active:scale-95"
            >
              <GithubIcon className="h-4 w-4" />
              View on GitHub
            </a>
          </div>

          {/* Stats Row */}
          <div className="flex flex-wrap items-center justify-center gap-8 text-sm">
            {[
              { icon: Smartphone, label: "Live Device Simulator" },
              { icon: Eye, label: "Figma vs Live Comparison" },
              { icon: Users, label: "Developer & Client Review" },
              { icon: CheckCircle, label: "1-Click Accept & Verify" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                <Icon className="h-4 w-4 text-blue-500" />
                <span className="font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* App Preview Card: Interactive Real Screenshot Viewer with Switchable Views */}
        <div className="mx-auto mt-16 max-w-5xl">
          {(() => {
            const currentPreview = PRODUCT_PREVIEWS.find((p) => p.id === previewTab) || PRODUCT_PREVIEWS[0]
            const CurrentIcon = currentPreview.icon

            return (
              <div className="relative rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/90 backdrop-blur shadow-2xl shadow-slate-900/20 dark:shadow-black/50 overflow-hidden text-left">
                {/* Fake browser chrome */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/95">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-red-400" />
                    <div className="h-3 w-3 rounded-full bg-amber-400" />
                    <div className="h-3 w-3 rounded-full bg-emerald-400" />
                    <div className="hidden sm:block ml-2 rounded-lg bg-slate-200/70 dark:bg-slate-800/70 px-3 py-1 text-xs text-slate-600 dark:text-slate-400 font-mono">
                      {currentPreview.url}
                    </div>
                  </div>

                  {/* View Selector Tabs */}
                  <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-800/80 p-1 rounded-xl overflow-x-auto max-w-full">
                    {PRODUCT_PREVIEWS.map((p) => {
                      const Icon = p.icon
                      const active = previewTab === p.id
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPreviewTab(p.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                            active
                              ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm"
                              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span>{p.title}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Expand Action */}
                  <button
                    type="button"
                    onClick={() =>
                      setLightboxImg({
                        src: currentPreview.src,
                        title: currentPreview.title,
                        desc: currentPreview.description,
                      })
                    }
                    className="hidden sm:flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
                    title="View full resolution"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    <span>Enlarge</span>
                  </button>
                </div>

                {/* Preview Image Body */}
                <div
                  className="relative group cursor-pointer bg-slate-950 overflow-hidden"
                  onClick={() =>
                    setLightboxImg({
                      src: currentPreview.src,
                      title: currentPreview.title,
                      desc: currentPreview.description,
                    })
                  }
                >
                  <img
                    src={currentPreview.src}
                    alt={currentPreview.alt}
                    className="w-full h-auto max-h-[540px] object-cover object-top transition-transform duration-500 group-hover:scale-[1.01]"
                  />

                  {/* Hover hint */}
                  <div className="absolute inset-0 bg-slate-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <span className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900/90 text-white text-xs font-semibold backdrop-blur shadow-lg">
                      <Maximize2 className="h-3.5 w-3.5" />
                      Click to expand full resolution
                    </span>
                  </div>
                </div>

                {/* Caption Footer */}
                <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    <span className="font-bold text-slate-800 dark:text-white">{currentPreview.title}:</span>
                    <span className="text-slate-600 dark:text-slate-300">{currentPreview.description}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${bgPillMap[currentPreview.color]}`}>
                      {currentPreview.badge}
                    </span>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        {/* Scroll cue */}
        <div className="flex justify-center mt-10">
          <a
            href="#screenshots"
            className="flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors animate-bounce"
          >
            <span className="text-xs font-medium">View All Screens</span>
            <ChevronDown className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* ─── REAL APPLICATION SCREENSHOTS GALLERY ─── */}
      <section id="screenshots" className="relative py-20 px-6 bg-slate-50/70 dark:bg-slate-950/40 border-y border-slate-200/60 dark:border-white/5">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 dark:border-blue-800/60 bg-blue-50 dark:bg-blue-950/30 px-4 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 mb-4">
              <Eye className="h-3.5 w-3.5" />
              Real Interface Walkthrough
            </div>
            <h2 className="text-3xl md:text-5xl font-black text-slate-900 dark:text-white tracking-tight mb-4">
              See the app in{" "}
              <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-violet-600 bg-clip-text text-transparent">
                action
              </span>
            </h2>
            <p className="text-slate-600 dark:text-slate-400 max-w-xl mx-auto text-base sm:text-lg">
              Explore the real screens: from live interactive device frames to structured developer notes, revision reasons, and 1-click client verification.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {PRODUCT_PREVIEWS.map((item) => {
              const Icon = item.icon
              return (
                <div
                  key={item.id}
                  className="group rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/70 p-4 sm:p-5 hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{item.title}</h3>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">{item.badge}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxImg({
                            src: item.src,
                            title: item.title,
                            desc: item.description,
                          })
                        }
                        className="text-xs text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1 hover:underline cursor-pointer"
                      >
                        <span>Enlarge</span>
                        <Maximize2 className="h-3 w-3" />
                      </button>
                    </div>

                    <div
                      onClick={() =>
                        setLightboxImg({
                          src: item.src,
                          title: item.title,
                          desc: item.description,
                        })
                      }
                      className="relative rounded-xl overflow-hidden border border-slate-200/80 dark:border-white/10 bg-slate-950 aspect-[16/10] cursor-pointer group-hover:border-blue-400/40 transition-colors"
                    >
                      <img
                        src={item.src}
                        alt={item.alt}
                        className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.02]"
                      />
                      <div className="absolute inset-0 bg-slate-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 text-white text-xs font-semibold backdrop-blur shadow-md">
                          <Maximize2 className="h-3 w-3" />
                          Click to enlarge
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="mt-4 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section id="features" className="relative py-24 px-6">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 dark:border-purple-800/60 bg-purple-50 dark:bg-purple-950/30 px-4 py-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300 mb-5">
              <Zap className="h-3.5 w-3.5" />
              Everything You Need
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 dark:text-white tracking-tight mb-4">
              Everything for{" "}
              <span className="bg-gradient-to-r from-purple-600 to-violet-600 bg-clip-text text-transparent">
                code-to-client handoffs
              </span>
            </h2>
            <p className="text-slate-600 dark:text-slate-400 max-w-xl mx-auto text-lg">
              No endless email threads. Test in interactive device frames, document developer notes, and get client approvals in clicks.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className="group relative rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/50 p-6 hover:border-slate-300 dark:hover:border-white/10 hover:shadow-xl hover:shadow-slate-900/5 dark:hover:shadow-black/30 transition-all duration-300"
              >
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr ${colorMap[f.color]} shadow-lg mb-5`}>
                  <f.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{f.title}</h3>
                <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section id="how-it-works" className="relative py-24 px-6 bg-slate-50/80 dark:bg-slate-950/50">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 dark:border-blue-800/60 bg-blue-50 dark:bg-blue-950/30 px-4 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 mb-5">
              <Play className="h-3.5 w-3.5" />
              Simple Process
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 dark:text-white tracking-tight mb-4">
              From upload to{" "}
              <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                approval in 4 steps
              </span>
            </h2>
            <p className="text-slate-600 dark:text-slate-400 max-w-xl mx-auto text-lg">
              A clean, repeatable process that keeps both you and your clients on the same page.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {STEPS.map((s, i) => (
              <div
                key={i}
                className="relative flex gap-5 rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/50 p-6 hover:shadow-xl hover:shadow-slate-900/5 dark:hover:shadow-black/30 transition-all duration-300"
              >
                <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr ${colorMap[s.color]} shadow-xl`}>
                  <s.icon className="h-7 w-7 text-white" />
                </div>
                <div>
                  <div className={`text-xs font-bold mb-1 ${bgPillMap[s.color]} inline-block px-2 py-0.5 rounded-full`}>
                    Step {s.step}
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1.5">{s.title}</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{s.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── OPEN SOURCE ─── */}
      <section id="open-source" className="relative py-24 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-3xl border border-slate-200 dark:border-white/10 bg-gradient-to-br from-slate-50 to-blue-50/40 dark:from-slate-900 dark:to-blue-950/20 p-10 md:p-16 overflow-hidden relative">
            <div className="absolute -top-20 -right-20 h-[300px] w-[300px] rounded-full bg-blue-500/10 dark:bg-blue-500/5 blur-[80px] pointer-events-none" />

            <div className="relative z-10 flex flex-col lg:flex-row items-start gap-10">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-6">
                  <Code2 className="h-3.5 w-3.5" />
                  Open Source
                </div>
                <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-4">
                  Free to use.{" "}
                  <span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">
                    Open to all.
                  </span>
                </h2>
                <p className="text-slate-600 dark:text-slate-400 text-lg leading-relaxed mb-8">
                  Design Review is open source and free for freelancers. The full source code is available on GitHub
                  under an open license — fork it, self-host it, contribute to it.
                </p>

                <div className="flex flex-wrap gap-3 mb-8">
                  {[
                    { icon: Globe, label: "Open Source", color: "text-blue-500" },
                    { icon: Lock, label: "MIT + Commons Clause", color: "text-amber-500" },
                    { icon: CheckCircle, label: "Free Forever", color: "text-emerald-500" },
                  ].map((b) => (
                    <div
                      key={b.label}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300"
                    >
                      <b.icon className={`h-4 w-4 ${b.color}`} />
                      {b.label}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 p-4">
                    <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <CheckCircle className="h-3.5 w-3.5" /> Permitted
                    </div>
                    <ul className="text-xs text-emerald-700 dark:text-emerald-300 space-y-1.5">
                      <li>✓ Use for client work</li>
                      <li>✓ Self-host for your team</li>
                      <li>✓ Fork &amp; contribute</li>
                      <li>✓ Personal &amp; commercial use</li>
                    </ul>
                  </div>
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 p-4">
                    <div className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5" /> Conditions
                    </div>
                    <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1.5">
                      <li>→ Keep attribution</li>
                      <li>→ Share modifications</li>
                      <li>→ Link to this project</li>
                    </ul>
                  </div>
                  <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/60 p-4">
                    <div className="text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5" /> Restricted
                    </div>
                    <ul className="text-xs text-red-700 dark:text-red-300 space-y-1.5">
                      <li>✗ Resell as a product</li>
                      <li>✗ Remove attribution</li>
                      <li>✗ Sublicense</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* GitHub Card */}
              <div className="shrink-0 w-full lg:w-72">
                <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/80 p-6 shadow-xl">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 dark:bg-white">
                      <GithubIcon className="h-5 w-5 text-white dark:text-slate-900" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">GitHub</div>
                      <div className="text-xs text-slate-500 font-mono">nareshbabunuli/Design-Review</div>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-5">
                    Open source design review workflow tracker for freelancers.
                  </p>
                  <div className="flex gap-3 text-xs font-medium mb-5">
                    <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
                      <Star className="h-3.5 w-3.5 text-amber-500" /> Stars
                    </span>
                    <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
                      <Code2 className="h-3.5 w-3.5 text-blue-500" /> TypeScript
                    </span>
                    <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
                      <Shield className="h-3.5 w-3.5 text-emerald-500" /> MIT
                    </span>
                  </div>
                  <a
                    href="https://github.com/nareshbabunuli/Design-Review"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-100 px-4 py-2.5 text-sm font-semibold text-white dark:text-slate-900 transition-colors"
                  >
                    <GithubIcon className="h-4 w-4" />
                    View Source Code
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="relative py-24 px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-4xl md:text-6xl font-black text-slate-900 dark:text-white tracking-tight mb-5">
            Ready to level up your{" "}
            <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-violet-600 bg-clip-text text-transparent">
              client approvals?
            </span>
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-lg mb-10 max-w-xl mx-auto">
            Give developers and clients a single place to simulate, review, and sign off on designs.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onGetStarted}
              className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 px-10 py-4 text-base font-bold text-white shadow-2xl shadow-blue-500/40 transition-all hover:-translate-y-0.5 active:scale-95"
            >
              Get Started Free <ArrowRight className="h-4 w-4" />
            </button>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              No credit card &middot; No setup &middot; Open source
            </span>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-slate-200 dark:border-white/5 py-10 px-6">
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500">
              <FolderKanban className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-bold text-slate-900 dark:text-white">Design Review</span>
          </div>

          <div className="flex items-center gap-6 text-sm text-slate-500 dark:text-slate-400">
            <span>&copy; {new Date().getFullYear()} Design Review</span>
            <a href="#open-source" className="hover:text-slate-700 dark:hover:text-slate-200 transition-colors">License</a>
            <a
              href="https://github.com/nareshbabunuli/Design-Review"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <GithubIcon className="h-4 w-4" /> GitHub
            </a>
          </div>

          <div className="text-xs text-slate-400 dark:text-slate-500 text-center md:text-right">
            MIT + Commons Clause &middot; Free for freelancers &amp; teams
          </div>
        </div>
      </footer>

      {/* ─── LIGHTBOX MODAL ─── */}
      {lightboxImg && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/85 backdrop-blur-md p-4 sm:p-6"
          onClick={() => setLightboxImg(null)}
        >
          <div
            className="relative max-w-5xl w-full bg-slate-900 border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-slate-950/90 text-white">
              <div>
                <h4 className="text-sm font-bold text-white">{lightboxImg.title}</h4>
                {lightboxImg.desc && <p className="text-xs text-slate-400">{lightboxImg.desc}</p>}
              </div>
              <button
                type="button"
                onClick={() => setLightboxImg(null)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors cursor-pointer"
                title="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-3 sm:p-5 bg-slate-950 flex items-center justify-center max-h-[80vh] overflow-auto">
              <img
                src={lightboxImg.src}
                alt={lightboxImg.title}
                className="max-h-[75vh] w-auto max-w-full rounded-lg object-contain shadow-2xl border border-white/5"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
