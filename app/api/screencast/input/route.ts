import { NextResponse } from "next/server"

/**
 * Canvas screencast input has been disabled for security.
 * Live preview now runs natively via iframe — no server-side input injection.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Screencast input is disabled. Use native iframe preview instead.",
      status: "disabled",
    },
    { status: 410 }
  )
}
