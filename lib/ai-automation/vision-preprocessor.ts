/**
 * OpenCV-based visual preprocessing for context-aware testing.
 * 
 * Provides:
 * - Element bounding box annotation on screenshots
 * - Visual saliency detection (what draws user attention)
 * - Layout clustering (spatial groupings of UI controls)
 * - Visual hierarchy scoring (prominence ranking)
 */

export type DOMElement = {
  selector: string
  bounds?: { x: number; y: number; width: number; height: number; top?: number; left?: number }
  label?: string
  type?: string
}

export type VisualFeatures = {
  engine?: "opencv-js" | "heuristic-fallback"
  annotatedImageUrl?: string
  annotatedImageBuffer?: Buffer
  features: {
    elementBoundingBoxes: Array<{
      selector: string
      box: [number, number, number, number] // [x, y, width, height]
      saliency: number // 0-1 score for visual prominence
      visualWeight: number // 0-1 combined size, contrast, position score
    }>
    layoutClusters: Array<{
      elements: string[]
      spatialGroup: "top" | "left" | "right" | "bottom" | "center"
      clusterCenter: [number, number]
    }>
    visualHierarchy: Array<{
      selector: string
      rank: number // 1 = most prominent
      prominence: number // 0-1 normalized score
    }>
  }
}

/**
 * Preprocess screenshot with visual analysis for Laya decision-making.
 * 
 * Currently implements lightweight analysis without OpenCV dependency.
 * TODO: Add full OpenCV integration for saliency maps and advanced features.
 */
export async function preprocessScreenshotForLaya(
  screenshotBuffer: Buffer,
  domElements: DOMElement[]
): Promise<VisualFeatures> {
  try {
    // Dynamically import sharp to avoid bundling in client code
    let sharp: any
    try {
      sharp = (await import("sharp")).default
    } catch (importError) {
      console.warn("[VisionPreprocessor] Sharp not available, using fallback analysis")
      return getFallbackFeatures(domElements)
    }

    // Get image metadata
    const metadata = await sharp(screenshotBuffer).metadata()
    const imageWidth = metadata.width || 1920
    const imageHeight = metadata.height || 1080

    // Filter elements with valid bounds
    const validElements = domElements.filter(
      (el) => el.bounds && el.bounds.width > 0 && el.bounds.height > 0
    )

    // Calculate visual features for each element
    const elementBoundingBoxes = validElements.map((el) => {
      const bounds = el.bounds!
      const x = bounds.x ?? bounds.left ?? 0
      const y = bounds.y ?? bounds.top ?? 0
      const width = bounds.width
      const height = bounds.height

      // Simple heuristic saliency based on size and position
      const areaNormalized = (width * height) / (imageWidth * imageHeight)
      const positionScore = calculatePositionScore(x, y, width, height, imageWidth, imageHeight)
      const sizeScore = Math.min(areaNormalized * 100, 1) // Normalize to 0-1
      
      // Combined visual weight (could be enhanced with actual saliency detection)
      const visualWeight = (sizeScore * 0.4) + (positionScore * 0.6)
      
      return {
        selector: el.selector,
        box: [x, y, width, height] as [number, number, number, number],
        saliency: visualWeight, // Placeholder for OpenCV saliency
        visualWeight,
      }
    })

    // Cluster elements by spatial proximity
    const layoutClusters = clusterBySpatialProximity(elementBoundingBoxes, imageWidth, imageHeight)

    // Rank elements by visual prominence
    const sortedByWeight = [...elementBoundingBoxes].sort((a, b) => b.visualWeight - a.visualWeight)
    const visualHierarchy = sortedByWeight.map((el, index) => ({
      selector: el.selector,
      rank: index + 1,
      prominence: el.visualWeight,
    }))

    // Create annotated image with bounding boxes (optional, for debugging)
    let annotatedImageBuffer: Buffer | undefined
    try {
      annotatedImageBuffer = await annotateImageWithBoundingBoxes(
        screenshotBuffer,
        elementBoundingBoxes,
        imageWidth,
        imageHeight,
        sharp
      )
    } catch (annotationError) {
      console.warn("[VisionPreprocessor] Could not annotate image:", annotationError)
    }

    return {
      annotatedImageBuffer,
      features: {
        elementBoundingBoxes,
        layoutClusters,
        visualHierarchy,
      },
    }
  } catch (error) {
    console.error("[VisionPreprocessor] Preprocessing failed:", error)
    // Return minimal features on error
    return {
      features: {
        elementBoundingBoxes: [],
        layoutClusters: [],
        visualHierarchy: [],
      },
    }
  }
}

/**
 * Calculate position score based on typical UI reading patterns (F-pattern, Z-pattern).
 * Elements at top-left get higher scores.
 */
function calculatePositionScore(
  x: number,
  y: number,
  width: number,
  height: number,
  imageWidth: number,
  imageHeight: number
): number {
  const centerX = x + width / 2
  const centerY = y + height / 2
  
  const normalizedX = centerX / imageWidth
  const normalizedY = centerY / imageHeight

  // F-pattern heuristic: top-left is most salient, decreases as you go down and right
  const horizontalScore = 1 - normalizedX * 0.5 // Left is better, but not heavily weighted
  const verticalScore = 1 - normalizedY * 0.7 // Top is significantly better

  return (horizontalScore + verticalScore) / 2
}

/**
 * Cluster elements by spatial proximity using simple grid-based grouping.
 */
function clusterBySpatialProximity(
  elements: Array<{ selector: string; box: [number, number, number, number] }>,
  imageWidth: number,
  imageHeight: number
): Array<{
  elements: string[]
  spatialGroup: "top" | "left" | "right" | "bottom" | "center"
  clusterCenter: [number, number]
}> {
  const clusters: Map<string, { selectors: string[]; boxes: [number, number, number, number][] }> = new Map()

  for (const el of elements) {
    const [x, y, width, height] = el.box
    const centerX = x + width / 2
    const centerY = y + height / 2

    // Determine spatial region
    const group = determineSpatialGroup(centerX, centerY, imageWidth, imageHeight)
    
    if (!clusters.has(group)) {
      clusters.set(group, { selectors: [], boxes: [] })
    }
    clusters.get(group)!.selectors.push(el.selector)
    clusters.get(group)!.boxes.push(el.box)
  }

  return Array.from(clusters.entries()).map(([group, data]) => {
    const avgX = data.boxes.reduce((sum, box) => sum + (box[0] + box[2] / 2), 0) / data.boxes.length
    const avgY = data.boxes.reduce((sum, box) => sum + (box[1] + box[3] / 2), 0) / data.boxes.length
    
    return {
      elements: data.selectors,
      spatialGroup: group as "top" | "left" | "right" | "bottom" | "center",
      clusterCenter: [avgX, avgY] as [number, number],
    }
  })
}

function determineSpatialGroup(
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number
): string {
  const normalizedX = x / imageWidth
  const normalizedY = y / imageHeight

  if (normalizedY < 0.25) return "top"
  if (normalizedY > 0.75) return "bottom"
  if (normalizedX < 0.25) return "left"
  if (normalizedX > 0.75) return "right"
  return "center"
}

/**
 * Fallback feature extraction when sharp is not available.
 * Uses DOM element bounds without image metadata.
 */
function getFallbackFeatures(domElements: DOMElement[]): VisualFeatures {
  // Assume standard viewport size if no image metadata
  const imageWidth = 1920
  const imageHeight = 1080

  // Filter elements with valid bounds
  const validElements = domElements.filter(
    (el) => el.bounds && el.bounds.width > 0 && el.bounds.height > 0
  )

  // Calculate visual features for each element
  const elementBoundingBoxes = validElements.map((el) => {
    const bounds = el.bounds!
    const x = bounds.x ?? bounds.left ?? 0
    const y = bounds.y ?? bounds.top ?? 0
    const width = bounds.width
    const height = bounds.height

    const areaNormalized = (width * height) / (imageWidth * imageHeight)
    const positionScore = calculatePositionScore(x, y, width, height, imageWidth, imageHeight)
    const sizeScore = Math.min(areaNormalized * 100, 1)
    const visualWeight = (sizeScore * 0.4) + (positionScore * 0.6)
    
    return {
      selector: el.selector,
      box: [x, y, width, height] as [number, number, number, number],
      saliency: visualWeight,
      visualWeight,
    }
  })

  const layoutClusters = clusterBySpatialProximity(elementBoundingBoxes, imageWidth, imageHeight)

  const sortedByWeight = [...elementBoundingBoxes].sort((a, b) => b.visualWeight - a.visualWeight)
  const visualHierarchy = sortedByWeight.map((el, index) => ({
    selector: el.selector,
    rank: index + 1,
    prominence: el.visualWeight,
  }))

  return {
    features: {
      elementBoundingBoxes,
      layoutClusters,
      visualHierarchy,
    },
  }
}

/**
 * Draw bounding boxes on the screenshot for visual debugging.
 * Uses SVG overlay for lightweight annotation without OpenCV.
 */
async function annotateImageWithBoundingBoxes(
  screenshotBuffer: Buffer,
  elements: Array<{ selector: string; box: [number, number, number, number]; visualWeight: number }>,
  imageWidth: number,
  imageHeight: number,
  sharp: any
): Promise<Buffer> {
  // Limit annotations to top 20 elements to avoid cluttering
  const topElements = elements
    .sort((a, b) => b.visualWeight - a.visualWeight)
    .slice(0, 20)

  // Generate SVG overlay with bounding boxes
  const svgRects = topElements
    .map((el, idx) => {
      const [x, y, width, height] = el.box
      const color = getColorForRank(idx)
      const opacity = 0.3 + (el.visualWeight * 0.4) // More prominent = more visible
      
      return `
        <rect 
          x="${x}" y="${y}" 
          width="${width}" height="${height}" 
          fill="none" 
          stroke="${color}" 
          stroke-width="2" 
          opacity="${opacity}"
        />
        <text 
          x="${x + 2}" y="${y + 12}" 
          font-family="Arial" 
          font-size="10" 
          fill="${color}"
          opacity="0.9"
        >${idx + 1}</text>
      `
    })
    .join("\n")

  const svgOverlay = Buffer.from(`
    <svg width="${imageWidth}" height="${imageHeight}">
      ${svgRects}
    </svg>
  `)

  // Composite SVG overlay onto screenshot
  return sharp(screenshotBuffer)
    .composite([
      {
        input: svgOverlay,
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer()
}

function getColorForRank(rank: number): string {
  const colors = [
    "#FF3B30", // Red - highest priority
    "#FF9500", // Orange
    "#FFCC00", // Yellow
    "#34C759", // Green
    "#00C7BE", // Teal
    "#30B0C7", // Light blue
    "#007AFF", // Blue
    "#5856D6", // Purple
  ]
  return colors[rank % colors.length]
}

/**
 * Future enhancement: Integrate OpenCV for advanced features.
 * 
 * Example OpenCV features to add:
 * - cv.saliency() for true visual saliency detection
 * - cv.findContours() for better element boundary detection
 * - cv.matchTemplate() for change detection (before/after screenshots)
 * - cv.text.OCRTesseract() for text extraction as fallback to DOM
 * 
 * Installation: npm install opencv4nodejs
 * Note: Requires native dependencies (CMake, OpenCV libraries)
 */
let openCvPromise: Promise<any> | undefined

async function loadOpenCv(): Promise<any> {
  if (!openCvPromise) {
    openCvPromise = (async () => {
      const imported = await import("@techstark/opencv-js")
      let cv: any = (imported as any).default ?? imported
      if (cv instanceof Promise) cv = await cv
      if (!cv?.Mat) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("OpenCV.js initialization timed out")), 15000)
          cv.onRuntimeInitialized = () => {
            clearTimeout(timeout)
            resolve()
          }
        })
      }
      if (!cv?.Mat || !cv?.Canny) throw new Error("OpenCV.js did not expose the required image APIs")
      return cv
    })().catch((error) => {
      openCvPromise = undefined
      throw error
    })
  }
  return openCvPromise
}

function measureEdgeDensity(
  edgeData: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  box: [number, number, number, number]
): number {
  const [rawX, rawY, rawWidth, rawHeight] = box
  const left = Math.max(0, Math.floor(rawX))
  const top = Math.max(0, Math.floor(rawY))
  const right = Math.min(imageWidth, Math.ceil(rawX + rawWidth))
  const bottom = Math.min(imageHeight, Math.ceil(rawY + rawHeight))
  if (right <= left || bottom <= top) return 0

  let edgePixels = 0
  let samples = 0
  const step = Math.max(1, Math.floor(Math.min(right - left, bottom - top) / 32))
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      if (edgeData[y * imageWidth + x] > 0) edgePixels++
      samples++
    }
  }
  return samples ? Math.min(1, edgePixels / samples * 3) : 0
}

/**
 * Use OpenCV.js edge detection to add image-derived evidence to DOM controls.
 * Falls back to the existing Sharp-based analysis if OpenCV cannot initialize.
 */
export async function preprocessWithOpenCV(
  screenshotBuffer: Buffer,
  domElements: DOMElement[]
): Promise<VisualFeatures> {
  let gray: any
  let edges: any
  try {
    const sharpModule = await import("sharp")
    const sharp = sharpModule.default
    const decoded = await sharp(screenshotBuffer).greyscale().raw().toBuffer({ resolveWithObject: true })
    const imageWidth = decoded.info.width
    const imageHeight = decoded.info.height
    if (!imageWidth || !imageHeight || !decoded.data.length) {
      throw new Error("Screenshot could not be decoded")
    }

    const cv = await loadOpenCv()
    gray = new cv.Mat(imageHeight, imageWidth, cv.CV_8UC1)
    gray.data.set(decoded.data)
    edges = new cv.Mat()
    cv.Canny(gray, edges, 50, 120)

    const validElements = domElements.filter(
      (element) => element.bounds && element.bounds.width > 0 && element.bounds.height > 0
    ).slice(0, 150)

    const elementBoundingBoxes = validElements.map((element) => {
      const bounds = element.bounds!
      const x = bounds.x ?? bounds.left ?? 0
      const y = bounds.y ?? bounds.top ?? 0
      const box: [number, number, number, number] = [x, y, bounds.width, bounds.height]
      const edgeDensity = measureEdgeDensity(edges.data, imageWidth, imageHeight, box)
      const areaNormalized = (bounds.width * bounds.height) / (imageWidth * imageHeight)
      const sizeScore = Math.min(areaNormalized * 100, 1)
      const positionScore = calculatePositionScore(x, y, bounds.width, bounds.height, imageWidth, imageHeight)
      const visualWeight = Math.min(1, edgeDensity * 0.55 + sizeScore * 0.2 + positionScore * 0.25)
      return {
        selector: element.selector,
        box,
        saliency: visualWeight,
        visualWeight,
      }
    })

    const layoutClusters = clusterBySpatialProximity(elementBoundingBoxes, imageWidth, imageHeight)
    const visualHierarchy = [...elementBoundingBoxes]
      .sort((a, b) => b.visualWeight - a.visualWeight)
      .map((element, index) => ({
        selector: element.selector,
        rank: index + 1,
        prominence: element.visualWeight,
      }))

    let annotatedImageBuffer: Buffer | undefined
    try {
      annotatedImageBuffer = await annotateImageWithBoundingBoxes(
        screenshotBuffer,
        elementBoundingBoxes,
        imageWidth,
        imageHeight,
        sharp
      )
    } catch (error) {
      console.warn("[VisionPreprocessor] Could not annotate OpenCV output:", error)
    }

    return {
      engine: "opencv-js",
      annotatedImageBuffer,
      features: { elementBoundingBoxes, layoutClusters, visualHierarchy },
    }
  } catch (error) {
    console.warn("[VisionPreprocessor] OpenCV unavailable; using fallback analysis:", error)
    const fallback = await preprocessScreenshotForLaya(screenshotBuffer, domElements)
    return { ...fallback, engine: "heuristic-fallback" }
  } finally {
    try { edges?.delete() } catch {}
    try { gray?.delete() } catch {}
  }
}
