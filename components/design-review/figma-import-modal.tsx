"use client"

import React, { useState, useEffect, useRef } from "react"
import {
  X,
  Sparkles,
  ExternalLink,
  Check,
  AlertCircle,
  Loader2,
  Layers,
  ArrowRight,
  RefreshCw,
  Search,
  Filter,
  CheckSquare,
  Square,
  KeyRound,
  FileText,
  Plus,
  FolderKanban,
  Eye,
  Zap,
  Folder,
  ChevronRight,
  Globe,
  Link as LinkIcon,
  Clock,
  ChevronDown,
  Upload,
  Image as ImageIcon,
  Archive,
  FileArchive,
} from "lucide-react"
import type { Project, Workflow } from "@/lib/design-review-types"
import { createClient } from "@/lib/supabase/client"
import JSZip from "jszip"

export interface FigmaScreenItem {
  id: string
  name: string
  pageId: string
  pageName: string
  width: number
  height: number
  type: string
  figmaUrl: string
  imageUrl?: string | null
}

export interface FigmaProjectFile {
  key: string
  name: string
  thumbnailUrl?: string | null
  lastModified?: string
}

export interface FigmaProjectItem {
  id: string
  name: string
  files: FigmaProjectFile[]
}

interface FigmaImportModalProps {
  isOpen: boolean
  onClose: () => void
  projects: Project[]
  activeProjectId?: string | null
  userId?: string | null
  onImportSuccess?: (projectId: string, importedWorkflows: Workflow[]) => void
}

export function FigmaImportModal({
  isOpen,
  onClose,
  projects,
  activeProjectId,
  userId,
  onImportSuccess,
}: FigmaImportModalProps) {
  const supabase = createClient()
  const zipInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const filesInputRef = useRef<HTMLInputElement>(null)

  // State: Token & user
  const [token, setToken] = useState<string>("")
  const [isTokenSaved, setIsTokenSaved] = useState<boolean>(false)
  const [figmaUser, setFigmaUser] = useState<{ id?: string; email?: string; handle?: string; img_url?: string } | null>(null)
  const [connecting, setConnecting] = useState<boolean>(false)
  const [connectError, setConnectError] = useState<string>("")

  // Navigation mode: "browse" (Fetch all projects) vs "direct" (Paste single file link)
  const [inputMode, setInputMode] = useState<"browse" | "direct">("browse")

  // Team & Projects browsing states
  const [teamInput, setTeamInput] = useState<string>("")
  const [teamName, setTeamName] = useState<string>("")
  const [teamProjects, setTeamProjects] = useState<FigmaProjectItem[]>([])
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false)
  const [projectsError, setProjectsError] = useState<string>("")
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

  // Single file & screen states
  const [fileUrl, setFileUrl] = useState<string>("")
  const [targetProjectId, setTargetProjectId] = useState<string>(activeProjectId || (projects[0]?.id || "new"))
  const [newProjectTitle, setNewProjectTitle] = useState<string>("")
  const [fetchingFile, setFetchingFile] = useState<boolean>(false)
  const [fetchError, setFetchError] = useState<string>("")

  const [fileName, setFileName] = useState<string>("")
  const [screens, setScreens] = useState<FigmaScreenItem[]>([])
  const [selectedScreenIds, setSelectedScreenIds] = useState<Set<string>>(new Set())
  const [searchFilter, setSearchFilter] = useState<string>("")
  const [selectedPage, setSelectedPage] = useState<string>("all")
  const [availablePages, setAvailablePages] = useState<string[]>([])

  const [importing, setImporting] = useState<boolean>(false)
  const [importProgress, setImportProgress] = useState<number>(0)
  const [importStatusText, setImportStatusText] = useState<string>("")
  const [previewImage, setPreviewImage] = useState<{ title: string; url: string } | null>(null)
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0)
  const [isMonthlyQuotaReached, setIsMonthlyQuotaReached] = useState<boolean>(false)
  const [isDragging, setIsDragging] = useState<boolean>(false)

  // Auto-retry countdown for Figma rate limits
  useEffect(() => {
    if (cooldownSeconds <= 0) return
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          handleSmartFetch()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldownSeconds])

  // Load saved token & team on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedToken = localStorage.getItem("figma_access_token") || ""
      const savedUserStr = localStorage.getItem("figma_user_profile")
      const savedTeam = localStorage.getItem("figma_team_id") || ""

      if (savedToken) {
        setToken(savedToken)
        setIsTokenSaved(true)
      }
      if (savedUserStr) {
        try {
          setFigmaUser(JSON.parse(savedUserStr))
        } catch {}
      }
      if (savedTeam) {
        setTeamInput(savedTeam)
      }
    }
  }, [isOpen])

  // Auto-fetch projects if token & teamId are already saved
  useEffect(() => {
    if (isOpen && token && teamInput && teamProjects.length === 0 && !loadingProjects) {
      handleFetchTeamProjects(teamInput)
    }
  }, [isOpen, token])

  // Pre-fill fileUrl from active project if available
  useEffect(() => {
    if (activeProjectId) {
      setTargetProjectId(activeProjectId)
      const curProject = projects.find((p) => p.id === activeProjectId)
      if (curProject?.figmaUrl && !fileUrl) {
        setFileUrl(curProject.figmaUrl)
      }
    } else if (projects.length > 0 && targetProjectId === "new") {
      setTargetProjectId(projects[0].id)
    }
  }, [activeProjectId, projects, isOpen])

  if (!isOpen) return null

  // Connect Figma Token
  const handleConnectToken = async (overrideToken?: string) => {
    const tokenToVerify = (overrideToken || token).trim()
    if (!tokenToVerify) {
      setConnectError("Please enter your Figma Personal Access Token.")
      return
    }

    setConnecting(true)
    setConnectError("")

    try {
      const res = await fetch("/api/figma/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenToVerify }),
      })

      const data = await res.json()
      if (!res.ok) {
        setConnectError(data.error || "Failed to connect to Figma. Please verify token.")
        setIsTokenSaved(false)
        return
      }

      setFigmaUser(data.user)
      setIsTokenSaved(true)
      setToken(tokenToVerify)
      if (typeof window !== "undefined") {
        localStorage.setItem("figma_access_token", tokenToVerify)
        localStorage.setItem("figma_user_profile", JSON.stringify(data.user))
      }
    } catch (err: any) {
      setConnectError(err.message || "Network error connecting to Figma.")
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = () => {
    setToken("")
    setIsTokenSaved(false)
    setFigmaUser(null)
    setScreens([])
    setSelectedScreenIds(new Set())
    setTeamProjects([])
    setTeamName("")
    if (typeof window !== "undefined") {
      localStorage.removeItem("figma_access_token")
      localStorage.removeItem("figma_user_profile")
      localStorage.removeItem("figma_team_id")
    }
  }

  // Fetch Team Projects & Files
  const handleFetchTeamProjects = async (overrideTeam?: string) => {
    const inputToUse = (overrideTeam || teamInput || fileUrl).trim()
    if (!token) {
      setProjectsError("Please connect your Figma token first.")
      return
    }
    if (!inputToUse) {
      setProjectsError("Please paste your Figma Team link or design file link.")
      return
    }

    setLoadingProjects(true)
    setProjectsError("")
    setFetchError("")

    try {
      const res = await fetch("/api/figma/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), teamIdOrUrl: inputToUse }),
      })

      const data = await res.json()
      if (!res.ok) {
        setProjectsError(data.error || "Failed to fetch projects for this team.")
        return
      }

      if (data.isDirectFile && data.fileKey) {
        setTeamProjects([])
        await handleFetchScreens(`https://www.figma.com/design/${data.fileKey}`)
        return
      }

      setTeamName(data.teamName || "Figma Workspace")
      const fetchedProjects: FigmaProjectItem[] = data.projects || []
      setTeamProjects(fetchedProjects)

      // Expand all projects by default
      setExpandedProjects(new Set(fetchedProjects.map((p) => p.id)))

      if (typeof window !== "undefined") {
        localStorage.setItem("figma_team_id", inputToUse)
      }
    } catch (err: any) {
      setProjectsError(err.message || "Network error fetching projects.")
    } finally {
      setLoadingProjects(false)
    }
  }

  // Fetch screens from a specific Figma file
  const handleFetchScreens = async (explicitFileUrl?: string) => {
    const urlToFetch = (explicitFileUrl || fileUrl || teamInput).trim()
    if (!token) {
      setFetchError("Please connect your Figma token first.")
      return
    }
    if (!urlToFetch) {
      setFetchError("Please provide a Figma file URL.")
      return
    }

    setFetchingFile(true)
    setFetchError("")
    setProjectsError("")
    setScreens([])
    setSelectedScreenIds(new Set())

    try {
      const res = await fetch("/api/figma/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), fileUrl: urlToFetch }),
      })

      const data = await res.json()
      if (!res.ok) {
        if (data.isRateLimit) {
          if (data.isMonthlyLimit || (data.retryAfter && data.retryAfter > 120)) {
            setIsMonthlyQuotaReached(true)
            setCooldownSeconds(0)
          } else {
            setCooldownSeconds(data.retryAfter || 30)
          }
        }
        setFetchError(data.error || "Failed to retrieve screens from Figma file.")
        return
      }

      setIsMonthlyQuotaReached(false)
      setFileUrl(urlToFetch)
      setTeamInput(urlToFetch)
      setFileName(data.fileName || "Figma Design")
      if (!newProjectTitle) {
        setNewProjectTitle(data.fileName || "Figma Import")
      }

      const extracted: FigmaScreenItem[] = data.screens || []
      if (extracted.length === 0) {
        setFetchError("No top-level screen artboards (width or height >= 160px) were found in this file.")
      }
      setScreens(extracted)

      const pages = Array.from(new Set(extracted.map((s) => s.pageName))).filter(Boolean)
      setAvailablePages(pages)
      setSelectedScreenIds(new Set(extracted.map((s) => s.id)))
    } catch (err: any) {
      setFetchError(err.message || "Failed to fetch Figma screens.")
    } finally {
      setFetchingFile(false)
    }
  }

  // Handle selecting or dropping Figma .zip export, extracted images, or folder
  const handleDropFiles = async (fileList: FileList | File[]) => {
    const rawFiles = Array.from(fileList)
    if (rawFiles.length === 0) return

    setFetchingFile(true)
    setFetchError("")

    // Check if any file is a .zip archive
    const zipFile = rawFiles.find(
      (f) =>
        f.name.toLowerCase().endsWith(".zip") ||
        f.type === "application/zip" ||
        f.type === "application/x-zip-compressed" ||
        f.type === "multipart/x-zip"
    )

    if (zipFile) {
      try {
        const zip = await JSZip.loadAsync(zipFile)
        const imageEntries: { name: string; entry: JSZip.JSZipObject }[] = []

        zip.forEach((relativePath, entry) => {
          if (entry.dir) return
          if (relativePath.includes("__MACOSX/") || relativePath.startsWith(".")) return
          if (/\.(png|jpe?g|webp|svg)$/i.test(relativePath)) {
            imageEntries.push({ name: relativePath, entry })
          }
        })

        if (imageEntries.length === 0) {
          setFetchError("No screen images (.png, .jpg, .webp) found inside this .zip file.")
          setFetchingFile(false)
          return
        }

        // Sort entries naturally so screen 1, screen 2, etc. appear in order
        imageEntries.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
        )

        const cleanZipName = zipFile.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").trim()
        const extractedScreens: FigmaScreenItem[] = []

        for (const item of imageEntries) {
          try {
            const ext = item.name.split(".").pop()?.toLowerCase() || "png"
            const mime =
              ext === "jpg" || ext === "jpeg"
                ? "image/jpeg"
                : ext === "webp"
                ? "image/webp"
                : ext === "svg"
                ? "image/svg+xml"
                : "image/png"

            const base64 = await item.entry.async("base64")
            const dataUrl = `data:${mime};base64,${base64}`

            // Base filename without extension or directory paths
            const baseName = item.name.split("/").pop() || item.name
            const cleanScreenName = baseName.replace(/\.[^/.]+$/, "").trim()

            await new Promise<void>((resolve) => {
              const img = new Image()
              img.onload = () => {
                extractedScreens.push({
                  id: "zip-" + Math.random().toString(36).substring(2, 9),
                  name: cleanScreenName || "Screen",
                  pageId: "zip-page",
                  pageName: cleanZipName || "Extracted Screens",
                  width: img.width || 1440,
                  height: img.height || 900,
                  type: "FRAME",
                  figmaUrl: fileUrl || "https://www.figma.com/design/TLy6vwMoHZZgwAlbkjRChN",
                  imageUrl: dataUrl,
                })
                resolve()
              }
              img.onerror = () => {
                extractedScreens.push({
                  id: "zip-" + Math.random().toString(36).substring(2, 9),
                  name: cleanScreenName || "Screen",
                  pageId: "zip-page",
                  pageName: cleanZipName || "Extracted Screens",
                  width: 1440,
                  height: 900,
                  type: "FRAME",
                  figmaUrl: fileUrl || "https://www.figma.com/design/TLy6vwMoHZZgwAlbkjRChN",
                  imageUrl: dataUrl,
                })
                resolve()
              }
              img.src = dataUrl
            })
          } catch (err) {
            console.warn("Failed reading entry inside zip:", item.name, err)
          }
        }

        if (extractedScreens.length > 0) {
          setScreens(extractedScreens)
          setSelectedScreenIds(new Set(extractedScreens.map((s) => s.id)))
          setAvailablePages([cleanZipName || "Extracted Screens"])
          const projectTitle = cleanZipName || "TOP 50 WEBSITES"
          setFileName(projectTitle)
          setNewProjectTitle(projectTitle)
        } else {
          setFetchError("Failed to extract any viewable images from the .zip file.")
        }
      } catch (err: any) {
        setFetchError(`Could not read .zip file: ${err.message || "Invalid archive format"}`)
      } finally {
        setFetchingFile(false)
      }
      return
    }

    // Otherwise, filter for image files (.png, .jpg, .webp, .svg)
    const imageFiles = rawFiles.filter(
      (f) => /\.(png|jpe?g|webp|svg)$/i.test(f.name) || f.type.startsWith("image/")
    )

    if (imageFiles.length === 0) {
      setFetchError("No screen images (.png, .jpg, .webp) or .zip files found.")
      setFetchingFile(false)
      return
    }

    // Sort entries naturally so screen 1, 2, 3 appear in order
    imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))

    const extractedScreens: FigmaScreenItem[] = []

    for (const file of imageFiles) {
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = (e) => resolve(e.target?.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })

        const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").trim()

        await new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => {
            extractedScreens.push({
              id: "export-" + Math.random().toString(36).substring(2, 9),
              name: cleanName || "Screen",
              pageId: "export-page",
              pageName: "Extracted Screens",
              width: img.width || 1440,
              height: img.height || 900,
              type: "FRAME",
              figmaUrl: fileUrl || "https://www.figma.com/design/TLy6vwMoHZZgwAlbkjRChN",
              imageUrl: dataUrl,
            })
            resolve()
          }
          img.onerror = () => {
            extractedScreens.push({
              id: "export-" + Math.random().toString(36).substring(2, 9),
              name: cleanName || "Screen",
              pageId: "export-page",
              pageName: "Extracted Screens",
              width: 1440,
              height: 900,
              type: "FRAME",
              figmaUrl: fileUrl || "https://www.figma.com/design/TLy6vwMoHZZgwAlbkjRChN",
              imageUrl: dataUrl,
            })
            resolve()
          }
          img.src = dataUrl
        })
      } catch (err) {
        console.warn("Failed reading image file:", file.name, err)
      }
    }

    if (extractedScreens.length > 0) {
      setScreens(extractedScreens)
      setSelectedScreenIds(new Set(extractedScreens.map((s) => s.id)))
      setAvailablePages(["Extracted Screens"])
      if (!newProjectTitle) setNewProjectTitle("TOP 50 WEBSITES")
      if (!fileName) setFileName("TOP 50 WEBSITES")
    } else {
      setFetchError("Could not load any screen images from the selection.")
    }

    setFetchingFile(false)
  }

  // Smart unified fetch: detects whether input is a direct file or team/workspace
  const handleSmartFetch = async (overrideUrl?: string) => {
    const target = (overrideUrl || fileUrl || teamInput).trim()
    if (!target) return

    const isFile =
      /figma\.com\/(?:file|design|proto|board)\/([a-zA-Z0-9_-]+)/i.test(target) ||
      /^[a-zA-Z0-9_-]{12,45}$/.test(target)

    if (isFile) {
      setFileUrl(target)
      setTeamInput(target)
      await handleFetchScreens(target)
    } else {
      setTeamInput(target)
      setFileUrl(target)
      await handleFetchTeamProjects(target)
    }
  }

  // Handle clicking a file from the Team Projects browser
  const handleSelectFile = (file: FigmaProjectFile) => {
    const constructedUrl = `https://www.figma.com/design/${file.key}/${encodeURIComponent(file.name)}`
    setFileUrl(constructedUrl)
    setFileName(file.name)
    setNewProjectTitle(file.name)
    handleFetchScreens(constructedUrl)
  }

  // Toggle project accordion
  const handleToggleProjectAccordion = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  // Demo mode
  const handleUseDemoScreens = () => {
    const demoScreens: FigmaScreenItem[] = [
      {
        id: "demo-1",
        name: "01 - Welcome & Authentication",
        pageId: "p1",
        pageName: "User Flow",
        width: 393,
        height: 852,
        type: "FRAME",
        figmaUrl: "https://www.figma.com/design/demo/Demo-Project?node-id=0-1",
        imageUrl: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80",
      },
      {
        id: "demo-2",
        name: "02 - Analytics & Activity Dashboard",
        pageId: "p1",
        pageName: "User Flow",
        width: 393,
        height: 852,
        type: "FRAME",
        figmaUrl: "https://www.figma.com/design/demo/Demo-Project?node-id=0-2",
        imageUrl: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80",
      },
      {
        id: "demo-3",
        name: "03 - Device Review & Simulator",
        pageId: "p2",
        pageName: "Components",
        width: 393,
        height: 852,
        type: "FRAME",
        figmaUrl: "https://www.figma.com/design/demo/Demo-Project?node-id=0-3",
        imageUrl: "https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=800&q=80",
      },
      {
        id: "demo-4",
        name: "04 - Settings & Permissions",
        pageId: "p2",
        pageName: "Components",
        width: 393,
        height: 852,
        type: "FRAME",
        figmaUrl: "https://www.figma.com/design/demo/Demo-Project?node-id=0-4",
        imageUrl: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=800&q=80",
      },
    ]

    setFileName("Mobile App Spec (Demo)")
    setFileUrl("https://www.figma.com/design/sampleDemoFile/Mobile-App-Spec")
    setScreens(demoScreens)
    setAvailablePages(["User Flow", "Components"])
    setSelectedScreenIds(new Set(demoScreens.map((s) => s.id)))
    setIsTokenSaved(true)
    setFigmaUser({
      handle: "Demo Designer",
      email: "demo@figma.com",
    })
  }

  // Toggle single screen selection
  const handleToggleScreen = (id: string) => {
    setSelectedScreenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Select all / Deselect all
  const handleSelectAll = (filteredItems: FigmaScreenItem[]) => {
    if (selectedScreenIds.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedScreenIds(new Set())
    } else {
      setSelectedScreenIds(new Set(filteredItems.map((s) => s.id)))
    }
  }

  // Filtered screens based on search and page selector
  const filteredScreens = screens.filter((screen) => {
    const matchesSearch = screen.name.toLowerCase().includes(searchFilter.toLowerCase())
    const matchesPage = selectedPage === "all" || screen.pageName === selectedPage
    return matchesSearch && matchesPage
  })

  // Execute Import of Selected Screens
  const handleImportScreens = async () => {
    const screensToImport = screens.filter((s) => selectedScreenIds.has(s.id))
    if (screensToImport.length === 0) {
      alert("Please select at least one screen to import.")
      return
    }

    setImporting(true)
    setImportProgress(10)
    setImportStatusText("Preparing project...")

    try {
      let finalProjectId = targetProjectId

      // 1. If creating new project from Figma file
      if (targetProjectId === "new") {
        const titleToUse = newProjectTitle.trim() || fileName || "Figma Imported Project"
        const { data: newProj, error: projErr } = await supabase
          .from("projects")
          .insert({
            title: titleToUse,
            user_id: userId,
            figma_url: fileUrl.trim() || null,
          })
          .select("*")
          .single()

        if (projErr || !newProj) {
          throw new Error(projErr?.message || "Failed to create new project.")
        }
        finalProjectId = newProj.id
      } else {
        // Update existing project's Figma URL if missing
        if (fileUrl.trim()) {
          try {
            await supabase.rpc("update_project_figma_url", {
              p_project_id: finalProjectId,
              p_figma_url: fileUrl.trim(),
            })
          } catch (e) {
            console.warn("Could not update project Figma URL:", e)
          }
        }
      }

      setImportProgress(20)

      // 2. Fetch full-length images for selected screens that don't have images yet
      const fileKey = fileUrl.match(/figma\.com\/(?:file|design|proto|board)\/([a-zA-Z0-9_-]+)/i)?.[1] || ""
      const screensNeedingImages = screensToImport.filter((s) => !s.imageUrl)
      const imageMap: Record<string, string> = {}

      if (screensNeedingImages.length > 0 && fileKey && token) {
        const chunkSize = 10
        for (let i = 0; i < screensNeedingImages.length; i += chunkSize) {
          const chunk = screensNeedingImages.slice(i, i + chunkSize)
          const currentCount = Math.min(i + chunkSize, screensNeedingImages.length)
          setImportStatusText(`Rendering screen visuals (${currentCount}/${screensNeedingImages.length})...`)
          setImportProgress(20 + Math.round((currentCount / screensNeedingImages.length) * 45))

          try {
            const imgRes = await fetch("/api/figma/images", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                token: token.trim(),
                fileKey,
                nodeIds: chunk.map((s) => s.id),
              }),
            })

            if (imgRes.ok) {
              const imgData = await imgRes.json()
              if (imgData?.images) {
                Object.assign(imageMap, imgData.images)
              }
            }
          } catch (err) {
            console.warn("Chunk render error:", err)
          }
        }
      }

      setImportProgress(70)
      setImportStatusText(`Saving ${screensToImport.length} screens to project...`)

      // 3. Prepare workflows payload
      const rowsToInsert = screensToImport.map((screen) => ({
        project_id: finalProjectId,
        title: screen.name || "Figma Screen",
        design_a: imageMap[screen.id] || screen.imageUrl || null,
        design_b: null,
        figma_url: screen.figmaUrl || null,
        our_notes: `Imported from Figma (${fileName}): Page "${screen.pageName}" — ${screen.width} × ${screen.height}px`,
        client_message: "",
        client_task_done: false,
        reason: "",
        is_done: false,
      }))

      // 3. Batch insert into workflows table in safe chunks of 5
      const insertedData: any[] = []
      const BATCH_SIZE = 5
      for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
        const batch = rowsToInsert.slice(i, i + BATCH_SIZE)
        const currentSaved = Math.min(i + batch.length, rowsToInsert.length)
        setImportProgress(60 + Math.round((currentSaved / rowsToInsert.length) * 35))
        setImportStatusText(`Saving screens (${currentSaved}/${rowsToInsert.length})...`)

        const { data: batchData, error: batchError } = await supabase
          .from("workflows")
          .insert(batch)
          .select("*")

        if (batchError) {
          throw new Error(batchError.message || "Failed to insert screen workflows.")
        }
        if (batchData) {
          insertedData.push(...batchData)
        }
      }

      setImportProgress(98)
      setImportStatusText("Finalizing import...")

      const mappedWorkflows: Workflow[] = (insertedData || []).map((data: any) => ({
        id: data.id,
        projectId: data.project_id,
        title: data.title,
        designA: data.design_a,
        designB: data.design_b,
        figmaUrl: data.figma_url,
        ourNotes: data.our_notes || "",
        clientMessage: data.client_message || "",
        clientTaskDone: data.client_task_done,
        reason: data.reason || "",
        isDone: data.is_done,
        comments: [],
        revisions: [],
      }))

      setImportProgress(100)
      setTimeout(() => {
        onImportSuccess?.(finalProjectId, mappedWorkflows)
        onClose()
      }, 500)
    } catch (err: any) {
      console.error("Import error:", err)
      alert(`Import failed: ${err.message || "Unknown error"}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden text-slate-900 dark:text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-500 via-purple-500 to-indigo-600 text-white shadow-md shadow-purple-500/25">
              <svg className="h-5 w-5" viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="currentColor"/>
                <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="currentColor"/>
                <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="currentColor"/>
                <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="currentColor"/>
                <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="currentColor"/>
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                  Import Screens from Figma
                </h2>
                {/* Figma Connected badge hidden */}
                {false && isTokenSaved && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
                    <Check className="h-3 w-3" />
                    Figma Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Upload your exported Figma .zip archive to extract and preview design screens
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Step 1: Connect Token Section (if not connected) - Hidden */}
          {false && (!isTokenSaved ? (
            <div className="p-5 rounded-2xl border border-purple-500/20 bg-purple-50/50 dark:bg-purple-950/20 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-purple-500" />
                    <span>Connect your Figma Account</span>
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                    Provide your Figma Personal Access Token to list your workspace projects and render screen specifications.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleUseDemoScreens}
                  className="shrink-0 px-3 py-1.5 rounded-xl border border-purple-300 dark:border-purple-800 bg-white dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-semibold hover:bg-purple-50 dark:hover:bg-purple-900/60 transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Try with pre-rendered sample screens"
                >
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span>Try Demo Mode</span>
                </button>
              </div>

              {connectError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-600 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{connectError}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste your Figma Personal Access Token (figd_...)"
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-mono placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500"
                />
                <button
                  type="button"
                  disabled={connecting || !token.trim()}
                  onClick={() => handleConnectToken()}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-purple-500/20 disabled:opacity-50 transition-all cursor-pointer shrink-0"
                >
                  {connecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{connecting ? "Connecting..." : "Connect Figma"}</span>
                </button>
              </div>

              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <span>Don't have a token?</span>
                <a
                  href="https://www.figma.com/settings"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-600 dark:text-purple-400 hover:underline font-medium inline-flex items-center gap-1"
                >
                  Generate in Figma Settings &gt; Security &gt; Personal access tokens
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ) : (
            /* Connected state info bar */
            false && <div className="p-3.5 rounded-2xl border border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-950/20 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold text-xs">
                  {figmaUser?.img_url ? (
                    <img src={figmaUser?.img_url} alt="" className="h-8 w-8 rounded-xl object-cover" />
                  ) : (
                    figmaUser?.handle?.slice(0, 2).toUpperCase() || "FG"
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span>{figmaUser?.handle || "Figma User"}</span>
                    <span className="text-[10px] text-slate-400 font-normal">({figmaUser?.email || "connected"})</span>
                  </div>
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                    ✓ Figma API authentication active
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ))}

          {/* Smart Unified URL / Link Input - Hidden */}
          {false && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Figma Design File URL or Workspace Link
                  </label>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    Paste any Figma design link (https://www.figma.com/design/...) or team link
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={fileUrl || teamInput}
                    onChange={(e) => {
                      const val = e.target.value
                      setFileUrl(val)
                      setTeamInput(val)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !(fetchingFile || loadingProjects)) {
                        handleSmartFetch()
                      }
                    }}
                    placeholder="https://www.figma.com/design/:fileId/:title"
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                  <button
                    type="button"
                    disabled={fetchingFile || loadingProjects || cooldownSeconds > 0 || (!fileUrl.trim() && !teamInput.trim())}
                    onClick={() => handleSmartFetch()}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {cooldownSeconds > 0 ? (
                      <>
                        <Clock className="h-4 w-4 animate-spin text-amber-300" />
                        <span>Retrying in {cooldownSeconds}s...</span>
                      </>
                    ) : fetchingFile ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Rendering Screens...</span>
                      </>
                    ) : loadingProjects ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Fetching Workspace...</span>
                      </>
                    ) : (
                      <>
                        <Layers className="h-4 w-4" />
                        <span>Fetch Screens</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* OR: Direct Extracted Folder / Images Upload */}
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-wider">
                  <span className="bg-white dark:bg-slate-900 px-3 text-purple-600 dark:text-purple-400 font-semibold">
                    Fastest: Upload Extracted Figma Screens (0 Rate Limits)
                  </span>
                </div>
              </div>
            </div>
          )}

              {/* Hidden file inputs for ZIP, Folder, and Multiple Files */}
              <input
                type="file"
                ref={zipInputRef}
                accept=".zip,application/zip,application/x-zip-compressed,multipart/x-zip"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleDropFiles(e.target.files)
                  }
                }}
              />
              <input
                type="file"
                ref={folderInputRef}
                // @ts-expect-error - webkitdirectory is standard in browsers
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleDropFiles(e.target.files)
                  }
                }}
              />
              <input
                type="file"
                ref={filesInputRef}
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleDropFiles(e.target.files)
                  }
                }}
              />

              {/* Upload Card with ZIP Button, Folder Button, Images Button & Drag-and-Drop Area */}
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleDropFiles(e.dataTransfer.files)
                  }
                }}
                className={`p-5 rounded-2xl border-2 border-dashed transition-all text-center flex flex-col items-center justify-center gap-3.5 ${
                  isDragging
                    ? "border-purple-500 bg-purple-50/50 dark:bg-purple-950/40 ring-4 ring-purple-500/20"
                    : "border-purple-300 dark:border-purple-700/60 bg-purple-50/20 dark:bg-purple-950/20 hover:border-purple-500"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow-md shadow-purple-500/20 shrink-0">
                    <Archive className="h-5 w-5" />
                  </div>
                  <div className="text-left">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                      Upload Figma Export (.ZIP File)
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Drop your exported Figma .zip file here to extract and preview all screens instantly
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => zipInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md shadow-purple-500/25 transition-all active:scale-95 cursor-pointer"
                  >
                    <Archive className="h-4 w-4" />
                    <span>Upload Figma .ZIP File</span>
                  </button>

                  {/* Manual folder and images buttons hidden */}
                  {false && (
                    <>
                      <button
                        type="button"
                        onClick={() => folderInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium shadow-xs transition-all active:scale-95 cursor-pointer"
                      >
                        <Folder className="h-3.5 w-3.5 text-purple-500" />
                        <span>Select Extracted Folder</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => filesInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium shadow-xs transition-all active:scale-95 cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5 text-purple-500" />
                        <span>Select PNG Images</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

          {/* Other options (Figma monthly quota, cooldown, team projects browser) - Hidden */}
          {false && (
            <div className="space-y-4">
              {/* Starter Monthly Quota Reached Banner & Direct Export Dropzone */}
              {isMonthlyQuotaReached && (
                <div className="p-4 rounded-2xl bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/25 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-amber-900 dark:text-amber-100">
                        Figma Starter (Free) Monthly API Quota Reached
                      </h4>
                      <p className="text-[11px] text-amber-800/90 dark:text-amber-200/90 leading-relaxed">
                        Figma restricts free accounts to 6 REST API calls per month (resets Oct 1st). Drop your exported <strong>.zip</strong> above or connect a different account below:
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {/* Option 1: Drop Exported ZIP / PNGs */}
                    <label className="group relative flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-amber-300 dark:border-amber-700/60 bg-white/70 dark:bg-slate-900/70 hover:bg-amber-500/5 hover:border-amber-500 transition-all cursor-pointer text-center">
                      <input
                        type="file"
                        multiple
                        accept=".zip,application/zip,application/x-zip-compressed,image/png,image/jpeg,image/webp"
                        className="sr-only"
                        onChange={(e) => {
                          if (e.target.files) handleDropFiles(e.target.files)
                        }}
                      />
                      <Archive className="h-5 w-5 text-amber-600 dark:text-amber-400 mb-1.5 group-hover:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Drop Figma .ZIP Export
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Extracts all full-page screens instantly
                      </span>
                    </label>

                    {/* Option 2: Connect Another Token */}
                    <div className="flex flex-col justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 text-left">
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                          <KeyRound className="h-3.5 w-3.5 text-purple-500" />
                          <span>Use Fresh Figma Account</span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                          Any new/different free Figma account has 6 fresh monthly calls.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        className="mt-2.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer text-center"
                      >
                        Disconnect &amp; Switch Token
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Cooldown Active Alert (only for short per-minute throttling <= 120s) */}
              {cooldownSeconds > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3 animate-pulse">
                  <div className="flex items-center gap-2.5">
                    <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                    <span>
                      Figma API rate limit cooling down. Retrying automatically in{" "}
                      <strong className="text-amber-600 dark:text-amber-400 font-bold">
                        {cooldownSeconds}s
                      </strong>
                      ...
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCooldownSeconds(0)
                      handleSmartFetch()
                    }}
                    className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-[11px] transition-colors cursor-pointer shrink-0"
                  >
                    Retry Now
                  </button>
                </div>
              )}

              {/* Error messages if any */}
              {fetchError && cooldownSeconds === 0 && !isMonthlyQuotaReached && (
                <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-600 dark:text-rose-300 flex items-center gap-2.5">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                  <span>{fetchError}</span>
                </div>
              )}

              {projectsError && (
                <div className="p-4 rounded-2xl bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200 space-y-2">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        Your Figma Token is fully authenticated!
                      </p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed mt-0.5">
                        {projectsError}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Discovered Projects & Files Tree (if user browsed a team) */}
              {teamProjects.length > 0 && (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Folder className="h-4 w-4 text-purple-500" />
                      <span>{teamName}</span>
                      <span className="text-slate-400 font-normal">
                        ({teamProjects.length} project{teamProjects.length !== 1 ? "s" : ""})
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Click any file to load and import its screens
                    </span>
                  </div>

                  <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                    {teamProjects.map((project) => {
                      const isExpanded = expandedProjects.has(project.id)
                      return (
                        <div
                          key={project.id}
                          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 overflow-hidden"
                        >
                          {/* Project Header Accordion */}
                          <div
                            onClick={() => handleToggleProjectAccordion(project.id)}
                            className="px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors select-none"
                          >
                            <div className="flex items-center gap-2">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-slate-400" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-slate-400" />
                              )}
                              <span className="text-xs font-bold text-slate-900 dark:text-white">
                                {project.name}
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                {project.files.length} file{project.files.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>

                          {/* Project Files List */}
                          {isExpanded && (
                            <div className="p-3 border-t border-slate-200 dark:border-slate-800/60 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              {project.files.length === 0 ? (
                                <div className="col-span-full py-4 text-center text-xs text-slate-400">
                                  No design files found in this project.
                                </div>
                              ) : (
                                project.files.map((file) => {
                                  const isSelectedFile = fileUrl.includes(file.key)
                                  return (
                                    <div
                                      key={file.key}
                                      onClick={() => handleSelectFile(file)}
                                      className={`group p-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                                        isSelectedFile
                                          ? "border-purple-500 bg-purple-50/40 dark:bg-purple-950/30 ring-1 ring-purple-500"
                                          : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-sm"
                                      }`}
                                    >
                                      {/* Thumbnail */}
                                      <div className="h-10 w-12 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden flex-shrink-0 flex items-center justify-center border border-slate-200 dark:border-slate-700">
                                        {file.thumbnailUrl ? (
                                          <img
                                            src={file.thumbnailUrl}
                                            alt=""
                                            className="h-full w-full object-cover"
                                          />
                                        ) : (
                                          <FileText className="h-5 w-5 text-slate-400" />
                                        )}
                                      </div>

                                      {/* Info */}
                                      <div className="flex-1 min-w-0">
                                        <h5 className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                                          {file.name}
                                        </h5>
                                        <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                          Key: {file.key}
                                        </p>
                                      </div>

                                      <div className="shrink-0">
                                        {fetchingFile && isSelectedFile ? (
                                          <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                                        ) : (
                                          <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-purple-500 group-hover:translate-x-0.5 transition-all" />
                                        )}
                                      </div>
                                    </div>
                                  )
                                })
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Destination project selection (shown whenever a file is selected or screens found) */}
          {(screens.length > 0 || fileUrl) && (
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-slate-950/30 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Import Destination Project
                  </label>
                  <select
                    value={targetProjectId}
                    onChange={(e) => setTargetProjectId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
                  >
                    <option value="new">+ Create New Project from this Figma file</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({p.workflows.length} screens)
                      </option>
                    ))}
                  </select>
                </div>

                {targetProjectId === "new" && (
                  <div className="space-y-1.5 animate-in fade-in duration-150">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      New Project Title
                    </label>
                    <input
                      type="text"
                      value={newProjectTitle}
                      onChange={(e) => setNewProjectTitle(e.target.value)}
                      placeholder={fileName || "e.g., Mobile Banking Redesign"}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {fetchError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-600 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{fetchError}</span>
            </div>
          )}

          {/* Step 3: Screen Grid & Selection */}
          {screens.length > 0 && (
            <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-zinc-800 animate-in fade-in duration-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-purple-500" />
                    <span>Select Screens to Import</span>
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    {selectedScreenIds.size} of {screens.length} selected
                  </span>
                </div>

                {/* Filter and Select All */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Search within screens */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search screens..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="pl-8 pr-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-36 sm:w-44"
                    />
                  </div>

                  {/* Page filter dropdown */}
                  {availablePages.length > 1 && (
                    <select
                      value={selectedPage}
                      onChange={(e) => setSelectedPage(e.target.value)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none cursor-pointer"
                    >
                      <option value="all">All Pages ({screens.length})</option>
                      {availablePages.map((pg) => (
                        <option key={pg} value={pg}>
                          {pg} ({screens.filter((s) => s.pageName === pg).length})
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Toggle All */}
                  <button
                    type="button"
                    onClick={() => handleSelectAll(filteredScreens)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    {selectedScreenIds.size === filteredScreens.length && filteredScreens.length > 0 ? (
                      <>
                        <Square className="h-3.5 w-3.5" />
                        <span>Deselect All</span>
                      </>
                    ) : (
                      <>
                        <CheckSquare className="h-3.5 w-3.5 text-blue-500" />
                        <span>Select All</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Screens Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5 max-h-[420px] overflow-y-auto p-1 rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-slate-950/40">
                {filteredScreens.map((screen) => {
                  const isSelected = selectedScreenIds.has(screen.id)
                  return (
                    <div
                      key={screen.id}
                      onClick={() => handleToggleScreen(screen.id)}
                      className={`group relative flex flex-col rounded-2xl border transition-all cursor-pointer overflow-hidden ${
                        isSelected
                          ? "border-blue-500 bg-blue-50/30 dark:bg-blue-950/20 shadow-md ring-1 ring-blue-500/40"
                          : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-700 opacity-70 hover:opacity-100"
                      }`}
                    >
                      {/* Checkbox badge */}
                      <div className="absolute top-2 left-2 z-10">
                        <div
                          className={`h-5 w-5 rounded-lg flex items-center justify-center transition-colors ${
                            isSelected
                              ? "bg-blue-600 text-white shadow-sm"
                              : "border border-slate-300 dark:border-slate-600 bg-white/90 dark:bg-slate-800/90 text-transparent"
                          }`}
                        >
                          <Check className="h-3.5 w-3.5 stroke-[3]" />
                        </div>
                      </div>

                      {/* Screen Preview Image / Wireframe Artboard */}
                      <div className="relative aspect-[9/16] max-h-48 w-full bg-slate-100 dark:bg-slate-950 overflow-hidden flex items-center justify-center p-2">
                        {screen.imageUrl ? (
                          <img
                            src={screen.imageUrl}
                            alt={screen.name}
                            className="w-full h-full object-contain transition-transform group-hover:scale-105 duration-200"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-2 flex flex-col justify-between items-center text-center group-hover:border-purple-400 dark:group-hover:border-purple-600 transition-colors">
                            <div className="w-full flex items-center justify-between text-[9px] text-slate-400 font-mono">
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-semibold text-slate-600 dark:text-slate-300">
                                {screen.type}
                              </span>
                              <span>{screen.width}px</span>
                            </div>

                            <div className="flex flex-col items-center gap-1.5 my-auto">
                              <div className="h-8 w-8 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                                <Layers className="h-4 w-4" />
                              </div>
                              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 line-clamp-2 px-1">
                                {screen.name}
                              </span>
                            </div>

                            <div className="w-full py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-[9px] font-medium text-purple-700 dark:text-purple-300">
                              {screen.width} × {screen.height}
                            </div>
                          </div>
                        )}

                        {/* Zoom button */}
                        {screen.imageUrl && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setPreviewImage({ title: screen.name, url: screen.imageUrl! })
                            }}
                            className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            title="Preview full screen"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Screen Details */}
                      <div className="p-2.5 flex flex-col justify-between flex-1 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate" title={screen.name}>
                            {screen.name}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {screen.pageName}
                          </p>
                        </div>

                        <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/60 text-[10px] text-slate-400">
                          <span>{screen.width} × {screen.height}</span>
                          <a
                            href={screen.figmaUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-blue-500 flex items-center gap-0.5 cursor-pointer"
                            title="Open node in Figma"
                          >
                            <span>Figma</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer / Import CTA */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-slate-900/90 flex flex-col sm:flex-row items-center justify-between gap-3">
          {importing ? (
            <div className="w-full space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                <span className="font-semibold flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                  <span>{importStatusText}</span>
                </span>
                <span>{importProgress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300 rounded-full"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {screens.length > 0 ? (
                  <span>
                    Ready to import <strong className="text-slate-900 dark:text-white">{selectedScreenIds.size}</strong> screen{selectedScreenIds.size !== 1 ? "s" : ""}
                  </span>
                ) : (
                  <span>Select a design file to inspect artboards &amp; import screens</span>
                )}
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={selectedScreenIds.size === 0 || importing}
                  onClick={handleImportScreens}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-xs font-semibold shadow-md shadow-blue-500/20 disabled:opacity-50 transition-all active:scale-95 cursor-pointer"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>
                    Import All Screens ({selectedScreenIds.size})
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Screen Preview Zoom Lightbox */}
      {previewImage && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4 animate-in fade-in duration-150"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <div className="flex items-center justify-between w-full pb-3 text-white">
              <span className="text-sm font-semibold truncate">{previewImage.title}</span>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <img
              src={previewImage.url}
              alt={previewImage.title}
              className="max-h-[80vh] w-auto rounded-xl object-contain shadow-2xl border border-zinc-800"
            />
          </div>
        </div>
      )}
    </div>
  )
}
