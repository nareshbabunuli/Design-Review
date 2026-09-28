"use client"

import { useState } from "react"

type Operation = "create_calendar_event" | "create_contact" | "send_email" | "show_map" | "open_wifi_settings" | "turn_on_flashlight" | "turn_off_flashlight"
type Run = { id: string; instruction: string; operation: Operation; arguments: Record<string, string>; status: "passed" | "failed"; timestamp: string; message: string }

function chooseOperation(instruction: string): Operation | null {
  const text = instruction.toLowerCase()
  if (/(calendar|meeting|appointment|event)/.test(text)) return "create_calendar_event"
  if (/(contact|phone number)/.test(text)) return "create_contact"
  if (/(email|e-mail|mail)/.test(text)) return "send_email"
  if (/(map|directions|location|navigate)/.test(text)) return "show_map"
  if (/(wi-fi|wifi)/.test(text)) return "open_wifi_settings"
  if (/(flashlight|torch)/.test(text)) return /(off|disable)/.test(text) ? "turn_off_flashlight" : "turn_on_flashlight"
  return null
}

const EXAMPLES = ["Create a calendar event for a team meeting", "Save a new contact", "Send an email", "Show a map of London", "Open Wi-Fi settings", "Turn on the flashlight"]

export default function AISimulatorPage() {
  const [instruction, setInstruction] = useState("")
  const [argumentsText, setArgumentsText] = useState("{}")
  const [runs, setRuns] = useState<Run[]>([])
  const [error, setError] = useState("")

  function runSimulation() {
    setError("")
    if (!instruction.trim()) { setError("Enter an instruction first."); return }
    let args: unknown
    try { args = JSON.parse(argumentsText) } catch { setError("Arguments must be valid JSON."); return }
    if (typeof args !== "object" || args === null || Array.isArray(args) || Object.values(args).some((value) => typeof value !== "string")) { setError("Arguments must be a JSON object with string values."); return }
    const operation = chooseOperation(instruction)
    if (!operation) { setError("No supported operation detected. Try one of the examples."); return }
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(Date.now())
    setRuns((previous) => [{ id, instruction: instruction.trim(), operation, arguments: args as Record<string, string>, status: "passed", timestamp: new Date().toISOString(), message: "Mock operation selected. No device action or message was sent." }, ...previous])
  }

  function downloadManifest() {
    const blob = new Blob([JSON.stringify({ version: 1, mode: "mock", runs }, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "ai-simulator-runs.json"
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <main className="min-h-screen bg-background p-4 text-foreground md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div><a href="/" className="text-sm text-muted-foreground underline">Back to Design Review</a><h1 className="mt-3 text-2xl font-semibold">AI Simulator</h1><p className="mt-1 text-sm text-muted-foreground">Standalone test page. The existing simulator is unchanged.</p></div>
          <span className="rounded-full border bg-muted px-3 py-1 text-xs font-medium">Mock mode · no real AI or device actions</span>
        </header>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
            <h2 className="font-semibold">New run</h2>
            <label className="block space-y-2 text-sm"><span>Instruction</span><textarea className="min-h-28 w-full rounded-md border bg-background p-3 text-foreground" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Describe an action to simulate" /></label>
            <div className="flex flex-wrap gap-2">{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => setInstruction(example)} className="rounded-full border px-3 py-1 text-xs hover:bg-accent">{example}</button>)}</div>
            <label className="block space-y-2 text-sm"><span>Arguments (optional JSON, string values)</span><textarea className="min-h-24 w-full rounded-md border bg-background p-3 font-mono text-xs text-foreground" value={argumentsText} onChange={(event) => setArgumentsText(event.target.value)} /></label>
            {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
            <button type="button" onClick={runSimulation} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Run mock simulation</button>
          </section>
          <aside className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm"><h2 className="font-semibold">Supported operations</h2><ul className="mt-3 space-y-2 text-xs text-muted-foreground">{["create_calendar_event", "create_contact", "send_email", "show_map", "open_wifi_settings", "turn_on_flashlight", "turn_off_flashlight"].map((item) => <li key={item} className="rounded border p-2 font-mono">{item}</li>)}</ul><p className="mt-4 text-xs text-muted-foreground">This page tests the interaction and manifest format only. It does not extract arguments, navigate your existing simulator, call an AI model, or persist results.</p></aside>
        </div>
        <section className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Run log ({runs.length})</h2><button type="button" disabled={!runs.length} onClick={downloadManifest} className="rounded-md border px-3 py-2 text-xs disabled:opacity-50">Download JSON manifest</button></div>{runs.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No test runs yet.</p> : <ol className="mt-4 divide-y">{runs.map((run) => <li key={run.id} className="py-3 text-sm"><p className="font-medium">{run.operation} <span className="ml-2 text-xs text-green-600">Mock selected</span></p><p className="mt-1 text-muted-foreground">{run.instruction}</p><pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(run.arguments, null, 2)}</pre><p className="mt-2 text-xs text-muted-foreground">{run.message} · {new Date(run.timestamp).toLocaleString()}</p></li>)}</ol>}</section>
      </div>
    </main>
  )
}
