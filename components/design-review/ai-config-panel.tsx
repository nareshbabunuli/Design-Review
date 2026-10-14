"use client"

import React, { useState } from "react"
import {
  Settings,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Activity,
  Loader2,
  Key,
  Eye,
  EyeOff,
} from "lucide-react"

export interface AiConfigPanelProps {
  aiProvider: "nebius" | "omnirouter" | "local"
  onUpdateAiProvider: (provider: "nebius" | "omnirouter" | "local") => void
  nebiusApiKey: string
  onUpdateNebiusApiKey: (key: string) => void
  selectedAiModel: string
  onUpdateAiModel: (model: string) => void
  omniRouterBaseUrl: string
  onUpdateOmniRouterUrl: (url: string) => void
  omniRouterKey: string
  onUpdateOmniRouterKey: (key: string) => void
  omniRouterModel: string
  onUpdateOmniRouterModel: (model: string) => void
  localAiBaseUrl: string
  onUpdateLocalBaseUrl: (url: string) => void
  isTestingAiConnection?: boolean
  onTestAiConnection: () => Promise<void> | void
  aiConnectionTestResult?: { success: boolean; message: string } | null
  onClose?: () => void
  isEmbedded?: boolean
}

export default function AiConfigPanel({
  aiProvider,
  onUpdateAiProvider,
  nebiusApiKey,
  onUpdateNebiusApiKey,
  selectedAiModel,
  onUpdateAiModel,
  omniRouterBaseUrl,
  onUpdateOmniRouterUrl,
  omniRouterKey,
  onUpdateOmniRouterKey,
  omniRouterModel,
  onUpdateOmniRouterModel,
  localAiBaseUrl,
  onUpdateLocalBaseUrl,
  isTestingAiConnection = false,
  onTestAiConnection,
  aiConnectionTestResult,
  onClose,
  isEmbedded = false,
}: AiConfigPanelProps) {
  const [showNebiusKey, setShowNebiusKey] = useState(false)
  const [showOmniKey, setShowOmniKey] = useState(false)

  return (
    <div className={`space-y-4 text-xs ${isEmbedded ? "max-w-3xl mx-auto py-2" : ""}`}>
      {/* Header Banner */}
      <div className="p-3.5 rounded-xl bg-gradient-to-r from-purple-950/60 via-slate-900 to-indigo-950/50 border border-purple-500/30 shadow-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-300 shrink-0">
              <Settings className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <span>AI Vision &amp; Automation Engine</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded font-mono uppercase bg-purple-900/60 text-purple-300 border border-purple-700/50">
                  {aiProvider}
                </span>
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                Configure the AI model and provider driving simulator visual testing, screen reasoning, and crawler audits.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Provider Selection Cards */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          <span>Select AI Provider</span>
          <span className="font-mono text-purple-400 lowercase font-normal">
            current: {aiProvider}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Nebius Token Factory */}
          <button
            type="button"
            onClick={() => onUpdateAiProvider("nebius")}
            className={`p-3 rounded-xl border text-left flex flex-col justify-between transition cursor-pointer ${
              aiProvider === "nebius"
                ? "bg-purple-950/50 border-purple-500 text-white shadow-md shadow-purple-950/40 ring-1 ring-purple-400/40"
                : "bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-bold text-[11px] text-purple-300">Nebius Token Factory</span>
              <span className="text-[8px] font-mono uppercase px-1 py-0.2 rounded bg-purple-900/60 text-purple-200">
                Top Vision
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1.5 leading-tight">
              NVIDIA Nemotron models via Nebius API
            </div>
          </button>

          {/* OmniRouter / UnoRouter */}
          <button
            type="button"
            onClick={() => onUpdateAiProvider("omnirouter")}
            className={`p-3 rounded-xl border text-left flex flex-col justify-between transition cursor-pointer ${
              aiProvider === "omnirouter"
                ? "bg-indigo-950/50 border-indigo-500 text-white shadow-md shadow-indigo-950/40 ring-1 ring-indigo-400/40"
                : "bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-bold text-[11px] text-indigo-300">Gateway</span>
              <span className="text-[8px] font-mono uppercase px-1 py-0.2 rounded bg-indigo-900/60 text-indigo-200">
                Combo
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1.5 leading-tight">
              OmniRouter / UnoRouter (Local :20128)
            </div>
          </button>

          {/* Local (Ollama) */}
          <button
            type="button"
            onClick={() => onUpdateAiProvider("local")}
            className={`p-3 rounded-xl border text-left flex flex-col justify-between transition cursor-pointer ${
              aiProvider === "local"
                ? "bg-emerald-950/50 border-emerald-500 text-white shadow-md shadow-emerald-950/40 ring-1 ring-emerald-400/40"
                : "bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-bold text-[11px] text-emerald-300">Local AI</span>
              <span className="text-[8px] font-mono uppercase px-1 py-0.2 rounded bg-emerald-900/60 text-emerald-200">
                Offline
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1.5 leading-tight">
              Ollama (Llama 3.2 Vision, Qwen-VL)
            </div>
          </button>
        </div>
      </div>

      {/* Detailed Provider Form */}
      {aiProvider === "nebius" && (
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-200 text-xs">Nebius Token Factory Settings</span>
            <a
              href="https://tokenfactory.nebius.com/"
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 underline underline-offset-2"
            >
              <span>Get API Key</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <p className="text-[10px] text-slate-400 leading-snug">
            Uses Nebius Token Factory&apos;s OpenAI-compatible API with NVIDIA Nemotron models for planning, visual QA, and recovery reasoning.
          </p>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Key className="h-3 w-3 text-purple-400" />
                <span>Nebius API Key</span>
              </span>
              {nebiusApiKey.trim() && (
                <span className="text-emerald-400 text-[9px] flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Key saved locally
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type={showNebiusKey ? "text" : "password"}
                value={nebiusApiKey}
                onChange={(e) => onUpdateNebiusApiKey(e.target.value)}
                placeholder="Paste your Nebius Token Factory API key"
                autoComplete="off"
                className="w-full bg-slate-950 border border-slate-700 focus:border-purple-500 rounded-lg pl-3 pr-8 py-2 text-[11px] text-white font-mono placeholder-slate-600 focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowNebiusKey(!showNebiusKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                title={showNebiusKey ? "Hide key" : "Show key"}
              >
                {showNebiusKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400">Model Preset</label>
            <select
              value={selectedAiModel}
              onChange={(e) => onUpdateAiModel(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 focus:border-purple-500 rounded-lg px-2.5 py-2 text-[11px] text-white cursor-pointer focus:outline-none transition-colors"
            >
              <option value="nvidia/Nemotron-3-Nano-Omni">NVIDIA Nemotron 3 Nano Omni (multimodal / fast)</option>
              <option value="nvidia/nemotron-3-super-120b-a12b">NVIDIA Nemotron 3 Super 120B (deep reasoning)</option>
              <option value="nvidia/Nemotron-3-Nano-30B-A3B">NVIDIA Nemotron 3 Nano 30B (balanced)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-slate-400">Custom Model ID</label>
            <input
              type="text"
              value={selectedAiModel}
              onChange={(e) => onUpdateAiModel(e.target.value)}
              placeholder="Use an exact model ID from your Nebius catalog"
              className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-[11px] text-slate-300 font-mono focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>
        </div>
      )}

      {aiProvider === "omnirouter" && (
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-200 text-xs">OmniRouter Gateway Settings</span>
            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-700/50">
              OpenAI Compatible
            </span>
          </div>

          {/* Presets */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onUpdateOmniRouterUrl("https://api.unorouter.com/v1")
                onUpdateOmniRouterModel("deepseek-v4-flash:free")
              }}
              className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-semibold border transition cursor-pointer text-center ${
                omniRouterBaseUrl.includes("unorouter")
                  ? "bg-indigo-600/30 border-indigo-500 text-indigo-200 font-bold"
                  : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
              }`}
            >
              UnoRouter (Free Cloud)
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateOmniRouterUrl("http://localhost:20128/v1")
                onUpdateOmniRouterModel("fast")
              }}
              className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-semibold border transition cursor-pointer text-center ${
                omniRouterBaseUrl.includes("20128")
                  ? "bg-indigo-600/30 border-indigo-500 text-indigo-200 font-bold"
                  : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
              }`}
            >
              OmniRoute (Local :20128)
            </button>
          </div>

          {/* Gateway URL */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400">Gateway Base URL</label>
            <input
              type="text"
              value={omniRouterBaseUrl}
              onChange={(e) => onUpdateOmniRouterUrl(e.target.value)}
              placeholder="https://api.unorouter.com/v1"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-[11px] text-white font-mono focus:outline-none transition-colors"
            />
          </div>

          {/* Key */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400 flex items-center justify-between">
              <span>Gateway API Key</span>
              <span className="text-[9px] text-slate-500">Free key at unorouter.com/token</span>
            </label>
            <div className="relative">
              <input
                type={showOmniKey ? "text" : "password"}
                value={omniRouterKey}
                onChange={(e) => onUpdateOmniRouterKey(e.target.value)}
                placeholder="Bearer key or token..."
                className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg pl-3 pr-8 py-2 text-[11px] text-white font-mono placeholder-slate-600 focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowOmniKey(!showOmniKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                title={showOmniKey ? "Hide key" : "Show key"}
              >
                {showOmniKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Model */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400">Model Identifier</label>
            <input
              type="text"
              value={omniRouterModel}
              onChange={(e) => onUpdateOmniRouterModel(e.target.value)}
              placeholder="fast, ddgw/gpt-5.4-mini, deepseek-v4-flash:free"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-[11px] text-white font-mono focus:outline-none transition-colors"
            />
            <div className="flex flex-wrap gap-1 pt-1">
              {["fast", "deepseek-v4-flash:free", "ddgw/gpt-5.4-mini", "ddgw/claude-haiku-4-5"].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onUpdateOmniRouterModel(m)}
                  className={`px-2 py-0.5 rounded text-[9px] font-mono cursor-pointer transition ${
                    omniRouterModel === m
                      ? "bg-indigo-600 text-white font-bold"
                      : "bg-slate-950 border border-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {aiProvider === "local" && (
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-200 text-xs">Ollama Local Settings</span>
            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-700/50">
              Private &amp; Offline
            </span>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400">Ollama Server URL</label>
            <input
              type="text"
              value={localAiBaseUrl}
              onChange={(e) => onUpdateLocalBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-[11px] text-white font-mono focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400">Local Model</label>
            <select
              value={selectedAiModel}
              onChange={(e) => onUpdateAiModel(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-2 text-[11px] text-white cursor-pointer focus:outline-none transition-colors"
            >
              <option value="llama3.2-vision">llama3.2-vision (Meta Vision)</option>
              <option value="qwen2-vl">qwen2-vl (Qwen Vision)</option>
              <option value="llava">llava (LLaVA)</option>
              <option value="mistral">mistral (Mistral 7B)</option>
            </select>
          </div>
          <p className="text-[10px] text-slate-500">
            Ensure Ollama is running locally:{" "}
            <code className="text-emerald-400 font-mono">ollama run llama3.2-vision</code>
          </p>
        </div>
      )}

      {/* Test Connection Button & Result */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTestAiConnection}
            disabled={isTestingAiConnection}
            className="flex-1 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 border border-slate-700"
          >
            {isTestingAiConnection ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                <span>Testing Connection...</span>
              </>
            ) : (
              <>
                <Activity className="h-3.5 w-3.5 text-purple-400" />
                <span>Test AI Connection</span>
              </>
            )}
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition shadow-sm cursor-pointer shrink-0"
            >
              Done
            </button>
          )}
        </div>

        {aiConnectionTestResult && (
          <div
            className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 animate-in fade-in-50 duration-150 ${
              aiConnectionTestResult.success
                ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-200"
                : "bg-rose-950/40 border-rose-500/50 text-rose-200"
            }`}
          >
            {aiConnectionTestResult.success ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
            )}
            <span className="leading-tight">{aiConnectionTestResult.message}</span>
          </div>
        )}
      </div>
    </div>
  )
}
