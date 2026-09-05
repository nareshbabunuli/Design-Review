"use client"

import React, { useState } from "react"
import { Download, Check, Copy, X, Save, Sparkles } from "lucide-react"

interface CapturedResultModalProps {
  isOpen: boolean
  imageUrl: string | null
  onClose: () => void
  onSaveToWorkflow: () => Promise<void>
  isSaving: boolean
}

export function CapturedResultModal({
  isOpen,
  imageUrl,
  onClose,
  onSaveToWorkflow,
  isSaving,
}: CapturedResultModalProps) {
  const [copied, setCopied] = useState(false)

  if (!isOpen || !imageUrl) return null

  const handleDownload = () => {
    const link = document.createElement("a")
    link.href = imageUrl
    link.download = `live-screen-capture-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleCopy = async () => {
    try {
      const res = await fetch(imageUrl)
      const blob = await res.blob()
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            [blob.type]: blob,
          }),
        ])
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(imageUrl)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      console.error("Clipboard copy error:", e)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white dark:bg-[#141620] border border-slate-200 dark:border-[#272b38] rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-[#202433]">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Captured Result</h3>
              <p className="text-[11px] text-slate-500 dark:text-[#7e8596]">Live screen area snapshot</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-md transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Image Preview Box */}
        <div className="p-4 bg-slate-100 dark:bg-[#0d0e14] flex items-center justify-center overflow-auto max-h-[55vh]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Captured Result"
            className="max-h-[50vh] max-w-full object-contain rounded-lg shadow-md border border-slate-200 dark:border-[#222736]"
          />
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-t border-slate-100 dark:border-[#202433] bg-white dark:bg-[#141620]">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleDownload}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#272b38] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1b1e2a] flex items-center gap-1.5 transition cursor-pointer"
              title="Download image to your computer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#272b38] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1b1e2a] flex items-center gap-1.5 transition cursor-pointer"
              title="Copy image to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "Copied!" : "Copy"}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition cursor-pointer"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={onSaveToWorkflow}
              disabled={isSaving}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? "Saving..." : "Save to Design B"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
