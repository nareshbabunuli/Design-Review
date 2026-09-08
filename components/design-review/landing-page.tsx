"use client"

import React, { useState, useEffect, useRef } from "react"
import {
  FolderKanban,
  ArrowRight,
  Layers,
  Share2,
  MessageSquare,
  Eye,
  CheckCircle,
  Users,
  Sparkles,
  Smartphone,
  Moon,
  Sun,
  Maximize2,
  X,
} from "lucide-react"

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

function useIntersectionObserver(options = { threshold: 0.1, triggerOnce: true }) {
  const [isVisible, setIsVisible] = useState(false)
  const domRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          if (options.triggerOnce && domRef.current) {
            observer.unobserve(domRef.current)
          }
        } else if (!options.triggerOnce) {
          setIsVisible(false)
        }
      })
    }, options)

    const currentRef = domRef.current
    if (currentRef) observer.observe(currentRef)

    return () => {
      if (currentRef) observer.unobserve(currentRef)
    }
  }, [options.threshold, options.triggerOnce])

  return [domRef, isVisible] as const
}

const Reveal = ({
  children,
  className = "",
  delay = 0,
  direction = "up",
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  direction?: "up" | "down" | "left" | "right"
}) => {
  const [ref, isVisible] = useIntersectionObserver()

  const getDirectionClass = () => {
    if (direction === "up") return "translate-y-8"
    if (direction === "down") return "-translate-y-8"
    if (direction === "left") return "translate-x-8"
    if (direction === "right") return "-translate-x-8"
    return "translate-y-4"
  }

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isVisible ? "opacity-100 translate-y-0 translate-x-0" : `opacity-0 ${getDirectionClass()}`
      } ${className}`}
    >
      {children}
    </div>
  )
}

export const PRODUCT_PREVIEWS = [
  {
    id: "simulator",
    title: "Device Simulator",
    badge: "Figma vs Live Frame",
    url: "designhub.app/simulator",
    src: "/screenshots/simulator-preview.png",
    description: "Run live web URLs in responsive device frames side-by-side with your Figma design specs.",
    icon: Smartphone,
  },
  {
    id: "editor",
    title: "Workflow Editor",
    badge: "Screens & Spec Notes",
    url: "designhub.app/editor",
    src: "/screenshots/editor-preview.png",
    description: "Upload Figma exports, paste app screenshots, provide developer notes, and manage screen states.",
    icon: Layers,
  },
  {
    id: "revisions",
    title: "Notes & Revisions",
    badge: "Direct Feedback",
    url: "designhub.app/revisions",
    src: "/screenshots/revisions-preview.png",
    description: "Submit developer notes, read client feedback, and document reasons for final revisions.",
    icon: MessageSquare,
  },
  {
    id: "dashboard",
    title: "Project Dashboard",
    badge: "Multi-Project Hub",
    url: "designhub.app/dashboard",
    src: "/screenshots/dashboard-preview.png",
    description: "Organize client projects, track completion progress, manage team access, and launch presentation reports.",
    icon: FolderKanban,
  },
]

const FEATURES = [
  {
    icon: Smartphone,
    title: "Interactive Simulator",
    description: "Test live URLs inside Phone, Tablet, and Desktop frames side-by-side with Figma specs.",
  },
  {
    icon: Users,
    title: "Client Collaboration",
    description: "Developers add designs and notes. Clients inspect, test, and provide direct feedback.",
  },
  {
    icon: MessageSquare,
    title: "Structured Notes",
    description: "Client messages and developer notes right on the screen. No endless email threads.",
  },
  {
    icon: Eye,
    title: "Spec Comparison",
    description: "Compare Figma designs directly against live app frames with Difference modes.",
  },
  {
    icon: CheckCircle,
    title: "1-Click Sign-off",
    description: "Clients verify and approve workflows with a single click. Export presentation reports.",
  },
  {
    icon: Share2,
    title: "Frictionless Sharing",
    description: "Generate secure invite links with custom view or edit permissions. No login required.",
  },
]

const STEPS = [
  { step: "1", title: "Import Designs", description: "Upload Figma designs and set live app URLs." },
  { step: "2", title: "Add Context", description: "Detail technical constraints and design structure." },
  { step: "3", title: "Share Link", description: "Clients test the live simulator and leave feedback." },
  { step: "4", title: "Get Approved", description: "Clients approve workflows with 1-click verification." },
]

const PrimaryButton = ({
  children,
  onClick,
  className = "",
  icon: Icon,
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  icon?: React.ComponentType<{ className?: string }>
}) => (
  <button
    onClick={onClick}
    className={`group relative flex items-center justify-center gap-2 rounded-full bg-[#1d1d1f] dark:bg-[#f5f5f7] px-6 py-3.5 text-sm font-medium text-white dark:text-[#1d1d1f] shadow-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-xl active:scale-[0.98] overflow-hidden cursor-pointer ${className}`}
  >
    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 dark:via-black/10 to-transparent group-hover:animate-shimmer transition-transform" />
    {Icon && <Icon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
    <span className="relative z-10">{children}</span>
  </button>
)

const SecondaryButton = ({
  children,
  onClick,
  className = "",
  icon: Icon,
  href,
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  icon?: React.ComponentType<{ className?: string }>
  href?: string
}) => {
  const baseClass = `group relative flex items-center justify-center gap-2 rounded-full bg-white dark:bg-[#1c1c1e] border border-slate-200 dark:border-white/10 px-6 py-3.5 text-sm font-medium text-slate-800 dark:text-white shadow-sm transition-all duration-300 hover:bg-slate-50 dark:hover:bg-[#2c2c2e] hover:shadow-md active:scale-[0.98] cursor-pointer ${className}`
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={baseClass}>
        {Icon && <Icon className="h-4 w-4 transition-transform group-hover:scale-110" />}
        <span className="relative z-10">{children}</span>
      </a>
    )
  }
  return (
    <button onClick={onClick} className={baseClass}>
      {Icon && <Icon className="h-4 w-4 transition-transform group-hover:scale-110" />}
      <span className="relative z-10">{children}</span>
    </button>
  )
}

const SegmentedControl = ({
  tabs,
  activeId,
  onChange,
}: {
  tabs: typeof PRODUCT_PREVIEWS
  activeId: string
  onChange: (id: string) => void
}) => (
  <div className="flex w-fit items-center gap-1 rounded-full bg-slate-100/80 dark:bg-white/5 p-1 backdrop-blur-md shadow-inner border border-slate-200/50 dark:border-white/5 overflow-x-auto no-scrollbar">
    {tabs.map((tab) => {
      const active = activeId === tab.id
      const Icon = tab.icon
      return (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`relative flex items-center gap-2 rounded-full px-4 sm:px-5 py-2 text-xs sm:text-sm font-medium transition-all duration-500 ease-out whitespace-nowrap cursor-pointer ${
            active
              ? "text-slate-900 dark:text-white shadow-sm bg-white dark:bg-white/10 border border-slate-200/50 dark:border-white/10 scale-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 border border-transparent scale-95 hover:scale-100"
          }`}
        >
          {Icon && <Icon className={`h-4 w-4 transition-colors duration-300 ${active ? "text-[#0071e3]" : ""}`} />}
          <span className="relative z-10">{tab.title}</span>
        </button>
      )
    })}
  </div>
)

interface LandingPageProps {
  onGetStarted: () => void
  theme?: "light" | "dark"
  onToggleTheme?: () => void
}

export function LandingPage({ onGetStarted, theme = "light", onToggleTheme }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false)
  const [previewTab, setPreviewTab] = useState("simulator")
  const [activeImage, setActiveImage] = useState(PRODUCT_PREVIEWS[0].src)
  const [isImageTransitioning, setIsImageTransitioning] = useState(false)
  const [lightboxImg, setLightboxImg] = useState<{ src: string; title: string; desc?: string } | null>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // Smooth crossfade for image swapping
  const handleTabChange = (id: string) => {
    if (id === previewTab) return
    setIsImageTransitioning(true)
    setPreviewTab(id)
    setTimeout(() => {
      const newImage = PRODUCT_PREVIEWS.find((p) => p.id === id)?.src || PRODUCT_PREVIEWS[0].src
      setActiveImage(newImage)
      setIsImageTransitioning(false)
    }, 250)
  }

  const currentPreview = PRODUCT_PREVIEWS.find((p) => p.id === previewTab) || PRODUCT_PREVIEWS[0]

  return (
    <div className="relative font-sans text-slate-900 dark:text-white min-h-screen bg-[#fbfbfd] dark:bg-[#000000] overflow-x-hidden transition-colors duration-500 ease-in-out">
      {/* Background Animated Blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#0071e3]/10 dark:bg-[#0071e3]/20 blur-[100px] animate-blob" />
        <div
          className="absolute top-[20%] right-[-10%] w-[40%] h-[60%] rounded-full bg-purple-500/5 dark:bg-purple-500/10 blur-[120px] animate-blob"
          style={{ animationDelay: "2s" }}
        />
        <div
          className="absolute bottom-[-20%] left-[20%] w-[60%] h-[50%] rounded-full bg-cyan-500/10 dark:bg-cyan-500/15 blur-[100px] animate-blob"
          style={{ animationDelay: "4s" }}
        />
      </div>

      {/* ─── NAVBAR ─── */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          scrolled
            ? "glass-panel border-b-slate-200/50 dark:border-b-white/10 shadow-sm py-3"
            : "bg-transparent border-b-transparent py-5"
        }`}
      >
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between">
          <div
            onClick={onGetStarted}
            className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <div
              className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#0071e3] text-white shadow-md animate-float"
              style={{ animationDuration: "8s" }}
            >
              <FolderKanban className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight text-lg">DesignReview</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
            <a
              href="#features"
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors duration-300"
            >
              Features
            </a>
            <a
              href="#workflow"
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors duration-300"
            >
              Workflow
            </a>
            <a
              href="https://github.com/nareshbabunuli/Design-Review"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors duration-300 group"
            >
              <GithubIcon className="h-4 w-4 group-hover:scale-110 transition-transform" /> GitHub
            </a>
          </nav>

          <div className="flex items-center gap-4">
            <button
              onClick={onToggleTheme}
              className="p-2.5 rounded-full hover:bg-slate-200/50 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 transition-all duration-300 hover:scale-110 active:scale-95 cursor-pointer"
              aria-label="Toggle Theme"
            >
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            <button
              onClick={onGetStarted}
              className="hidden sm:block rounded-full bg-[#1d1d1f] dark:bg-white px-5 py-2.5 text-sm font-medium text-white dark:text-[#1d1d1f] hover:scale-105 hover:shadow-lg transition-all duration-300 active:scale-95 cursor-pointer"
            >
              Get Started
            </button>
          </div>
        </div>
      </header>

      {/* ─── HERO SECTION ─── */}
      <section className="relative z-10 pt-36 sm:pt-40 pb-20 px-6 min-h-[90vh] flex flex-col items-center justify-start overflow-hidden">
        <div className="mx-auto max-w-4xl text-center">
          <Reveal delay={100}>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 dark:border-white/10 glass-panel px-4 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 mb-8 shadow-sm hover:scale-105 transition-transform duration-300 cursor-default">
              <Sparkles className="h-3.5 w-3.5 text-[#0071e3]" />
              Interactive Simulator for Modern Teams
            </div>
          </Reveal>

          <Reveal delay={200}>
            <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-[4rem] font-semibold tracking-tight leading-[1.08] mb-6 text-slate-900 dark:text-white">
              Design review with <br className="hidden sm:block" />
              <span className="text-gradient-shimmer animate-shimmer">Live Device Simulator</span>
            </h1>
          </Reveal>

          <Reveal delay={300}>
            <p className="text-base md:text-lg text-slate-500 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed mb-10 font-medium">
              Test live preview URLs in responsive device frames, compare against Figma specs side-by-side, and collaborate with structured notes and 1-click approvals.
            </p>
          </Reveal>

          <Reveal delay={400}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
              <PrimaryButton onClick={onGetStarted}>Start Free — No Credit Card</PrimaryButton>
              <SecondaryButton href="https://github.com/nareshbabunuli/Design-Review" icon={GithubIcon}>
                View on GitHub
              </SecondaryButton>
            </div>
          </Reveal>
        </div>

        {/* ─── HERO MOCKUP ─── */}
        <Reveal delay={500} className="w-full max-w-5xl mx-auto relative z-20">
          {/* Segmented Control Centered above mockup */}
          <div className="flex justify-center mb-6">
            <SegmentedControl tabs={PRODUCT_PREVIEWS} activeId={previewTab} onChange={handleTabChange} />
          </div>

          {/* Clean, shadow-lifted browser window mockup */}
          <div className="rounded-[24px] border border-slate-200/60 dark:border-white/10 glass-panel shadow-2xl overflow-hidden transition-all duration-700 hover:shadow-[0_20px_60px_-15px_rgba(0,113,227,0.18)] group relative">
            {/* Ambient glow behind mockup */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent dark:from-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none z-10" />

            {/* Chrome Bar */}
            <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-200/60 dark:border-white/10 bg-slate-50/80 dark:bg-[#1c1c1e]/80 backdrop-blur-md relative z-20">
              <div className="flex gap-2">
                <div className="h-3 w-3 rounded-full bg-[#ff5f56] shadow-sm hover:scale-110 transition-transform" />
                <div className="h-3 w-3 rounded-full bg-[#ffbd2e] shadow-sm hover:scale-110 transition-transform" />
                <div className="h-3 w-3 rounded-full bg-[#27c93f] shadow-sm hover:scale-110 transition-transform" />
              </div>
              <div className="ml-4 flex-1 flex justify-center">
                <div className="w-full max-w-md bg-white/60 dark:bg-black/40 border border-slate-200/50 dark:border-white/5 rounded-md px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono flex items-center justify-center shadow-inner transition-colors">
                  {currentPreview.url}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setLightboxImg({
                    src: activeImage,
                    title: currentPreview.title,
                    desc: currentPreview.description,
                  })
                }
                className="hidden sm:flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer"
                title="Expand screenshot"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Enlarge</span>
              </button>
            </div>

            {/* Image Content with crossfade */}
            <div
              className="relative bg-slate-100 dark:bg-[#0a0a0c] aspect-[16/10] sm:aspect-[16/9] overflow-hidden cursor-pointer"
              onClick={() =>
                setLightboxImg({
                  src: activeImage,
                  title: currentPreview.title,
                  desc: currentPreview.description,
                })
              }
            >
              <img
                src={activeImage}
                alt={currentPreview.title}
                className={`w-full h-full object-cover object-top transition-all duration-500 ${
                  isImageTransitioning ? "opacity-0 scale-[1.02] blur-sm" : "opacity-100 scale-100 blur-0"
                } group-hover:scale-[1.01]`}
              />

              {/* Subdued overlay metadata badge */}
              <div className="absolute bottom-6 left-6 flex items-center gap-2 glass-panel px-4 py-2 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-2 group-hover:translate-y-0 z-20">
                <div className="h-2 w-2 rounded-full bg-[#0071e3] shadow-[0_0_8px_rgba(0,113,227,0.8)] animate-pulse" />
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {currentPreview.badge}
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ─── FEATURES ─── */}
      <section id="features" className="py-28 px-6 relative z-10">
        <div className="mx-auto max-w-6xl">
          <Reveal direction="up">
            <div className="text-center mb-20">
              <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight mb-4">
                Built for seamless handoffs
              </h2>
              <p className="text-slate-500 dark:text-slate-400 max-w-2xl mx-auto text-lg">
                A clean, repeatable process that eliminates friction and keeps both you and your clients aligned.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {FEATURES.map((f, i) => (
              <Reveal key={i} delay={i * 100} direction="up">
                <div className="group flex flex-col p-8 rounded-[24px] glass-panel transition-all duration-500 hover:shadow-xl hover:-translate-y-1 hover:bg-white/90 dark:hover:bg-[#1c1c1e]/90 cursor-default">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-white/5 shadow-inner mb-6 text-[#0071e3] group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold mb-3 tracking-tight group-hover:text-[#0071e3] transition-colors duration-300">
                    {f.title}
                  </h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors duration-300">
                    {f.description}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── WORKFLOW ─── */}
      <section
        id="workflow"
        className="py-28 px-6 relative z-10 border-y border-slate-200/30 dark:border-white/5 bg-slate-50/30 dark:bg-white/[0.02]"
      >
        <div className="mx-auto max-w-5xl">
          <Reveal direction="up">
            <div className="text-center mb-20">
              <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight mb-4">
                From upload to approval in 4 steps
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {STEPS.map((s, i) => (
              <Reveal key={i} delay={i * 150} direction={i % 2 === 0 ? "left" : "right"}>
                <div className="group flex gap-6 p-8 rounded-[24px] glass-panel transition-all duration-500 hover:shadow-md hover:border-[#0071e3]/30 dark:hover:border-[#0071e3]/30">
                  <div className="shrink-0 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 text-lg font-semibold text-slate-400 dark:text-slate-500 group-hover:bg-[#0071e3] group-hover:text-white transition-colors duration-500 shadow-inner group-hover:shadow-[0_0_15px_rgba(0,113,227,0.4)]">
                    {s.step}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2 tracking-tight group-hover:text-[#0071e3] transition-colors duration-300">
                      {s.title}
                    </h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{s.description}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="py-28 px-6 relative z-10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0071e3]/5 dark:to-[#0071e3]/10 pointer-events-none" />
        <Reveal direction="up" className="mx-auto max-w-3xl text-center relative z-20">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-3xl bg-[#0071e3] text-white shadow-[0_10px_30px_rgba(0,113,227,0.3)] mb-8 animate-float">
            <FolderKanban className="h-8 w-8" />
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight mb-6">
            Ready to level up your client approvals?
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-lg mb-10 max-w-xl mx-auto">
            Give developers and clients a single place to simulate, review, and sign off on designs. Open source and free.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <PrimaryButton onClick={onGetStarted} className="px-8 py-4 text-base">
              Get Started Free
            </PrimaryButton>
          </div>
        </Reveal>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-slate-200/50 dark:border-white/10 py-12 px-6 relative z-10 bg-white/50 dark:bg-[#000000]/50 backdrop-blur-lg">
        <div className="mx-auto max-w-6xl flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 group cursor-pointer" onClick={onGetStarted}>
            <div className="flex h-6 w-6 items-center justify-center rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 group-hover:bg-[#0071e3] group-hover:text-white transition-colors duration-300">
              <FolderKanban className="h-3 w-3" />
            </div>
            <span className="text-sm font-semibold tracking-tight">DesignReview</span>
          </div>

          <div className="flex items-center gap-6 text-sm text-slate-500 dark:text-slate-400">
            <span>&copy; {new Date().getFullYear()} DesignReview.</span>
            <a
              href="https://github.com/nareshbabunuli/Design-Review"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-900 dark:hover:text-white transition-colors duration-300"
            >
              GitHub
            </a>
            <a
              href="https://github.com/nareshbabunuli/Design-Review"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-900 dark:hover:text-white transition-colors duration-300"
            >
              License (MIT)
            </a>
          </div>
        </div>
      </footer>

      {/* ─── LIGHTBOX MODAL ─── */}
      {lightboxImg && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/85 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-200"
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
