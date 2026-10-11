/**
 * Public outcome-verification surface.
 * Pure element semantics live in outcome-semantics.ts (safe for unit tests).
 * Heavy Puppeteer helpers live in outcome-verifier-impl.ts.
 */
export type { ElementSemantics } from "./outcome-semantics"
export { expectFor } from "./outcome-semantics"

export {
  type PageSnapshot,
  normalizeVisibleText,
  captureState,
  detectEmptyDataSurfaces,
  detectBrokenDomAssets,
  probeVolatility,
  NetworkRecorder,
  ConsoleRecorder,
  settle,
  classifyEffect,
  runWithLadder,
  verifyModalCloseAndFocus,
} from "./outcome-verifier-impl"
