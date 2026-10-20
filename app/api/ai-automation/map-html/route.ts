import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/ai-automation/job-store";
import { generateAppMapHtml } from "@/lib/ai-automation/map-html-exporter";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    const download = searchParams.get("download") === "true";

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId parameter" }, { status: 400 });
    }

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const html = generateAppMapHtml({
      plan: job.fullAppTestPlan || undefined,
      screens: job.screens || job.fullAppTestPlan?.screens || [],
      transitions: job.fullAppTestPlan?.transitions || [],
      title: `${job.targetUrl || "App"} - Interactive App Map`,
      targetUrl: job.targetUrl,
      timestamp: (job as any).completedAt || (job as any).createdAt,
    });

    const headers = new Headers();
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");

    if (download) {
      const sanitized = (job.targetUrl || "app-map").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
      headers.set("Content-Disposition", `attachment; filename="app-map-${sanitized}-${Date.now()}.html"`);
    }

    return new NextResponse(html, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("[MapHtmlRoute] Error generating app map HTML:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate App Map HTML" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { plan, screens, transitions, title, targetUrl } = body || {};

    const html = generateAppMapHtml({
      plan,
      screens: screens || plan?.screens || [],
      transitions: transitions || plan?.transitions || [],
      title: title || `${targetUrl || "App"} - Interactive App Map`,
      targetUrl,
      timestamp: new Date().toISOString(),
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("[MapHtmlRoute] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate HTML from payload" },
      { status: 500 }
    );
  }
}
