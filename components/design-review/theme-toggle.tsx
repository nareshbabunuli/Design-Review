"use client"

import { Sun, Moon } from "lucide-react"

interface ThemeToggleProps {
  theme: "light" | "dark"
  onToggle: () => void
  className?: string
}

export function ThemeToggle({ theme, onToggle, className = "" }: ThemeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex h-8 w-8 items-center justify-center rounded-xl border transition-all active:scale-95 cursor-pointer ${
        theme === "dark"
          ? "border-zinc-700/80 bg-zinc-800/90 text-amber-400 hover:bg-zinc-700 hover:text-amber-300 shadow-sm"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900 shadow-sm"
      } ${className}`}
      title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
      aria-label={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4 transition-transform hover:rotate-45 duration-300" />
      ) : (
        <Moon className="h-4 w-4 transition-transform hover:-rotate-12 duration-300" />
      )}
    </button>
  )
}
