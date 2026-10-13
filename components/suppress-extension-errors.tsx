"use client"

import { useEffect } from "react"

export default function SuppressExtensionErrors() {
  useEffect(() => {
    function isExtensionError(event: ErrorEvent | PromiseRejectionEvent) {
      const reason = "reason" in event ? event.reason : undefined
      const message =
        (event instanceof ErrorEvent ? event.message || event.filename : reason?.message) || ""
      const stack =
        (event instanceof ErrorEvent ? event.error?.stack : reason?.stack) || ""

      return (
        message.includes("Verification timed out") ||
        message.includes("csSpoofGeo") ||
        message.includes("chrome-extension://") ||
        stack.includes("chrome-extension://")
      )
    }

    const handleError = (event: ErrorEvent) => {
      if (isExtensionError(event)) {
        event.stopImmediatePropagation()
        event.preventDefault()
      }
    }
    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isExtensionError(event)) {
        event.stopImmediatePropagation()
        event.preventDefault()
      }
    }

    window.addEventListener("error", handleError, true)
    window.addEventListener("unhandledrejection", handleRejection, true)
    return () => {
      window.removeEventListener("error", handleError, true)
      window.removeEventListener("unhandledrejection", handleRejection, true)
    }
  }, [])

  return null
}
