import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env.local
const envPath = path.join(__dirname, "../.env.local")
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8")
  envContent.split("\n").forEach((line) => {
    if (line.startsWith("#") || !line.includes("=")) return
    const [key, ...valueParts] = line.split("=")
    const value = valueParts.join("=").replace(/^"(.*)"$/, "$1")
    process.env[key.trim()] = value.trim()
  })
}

const postgresUrl = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL

async function applyRLSPolicies() {
  console.log("🚀 Applying Database & Storage RLS policies...\n")

  if (!postgresUrl) {
    console.error("❌ POSTGRES_URL or POSTGRES_URL_NON_POOLING is missing from .env.local")
    console.log("ℹ️  You can apply policies manually in the Supabase SQL Editor using:")
    console.log("   - supabase/migrations/add_workflow_rls_policies.sql")
    console.log("   - supabase/migrations/add_storage_rls_policies.sql")
    process.exit(1)
  }

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

  try {
    const { default: pg } = await import("pg")
    const client = new pg.Client({
      connectionString: postgresUrl,
      ssl: { rejectUnauthorized: false },
    })

    await client.connect()
    console.log("✓ Connected to PostgreSQL database")

    // 1. Workflow & Comments RLS Policies
    const workflowMigrationPath = path.join(__dirname, "../supabase/migrations/add_workflow_rls_policies.sql")
    if (fs.existsSync(workflowMigrationPath)) {
      const sql = fs.readFileSync(workflowMigrationPath, "utf-8")
      console.log("  Applying workflow & comment RLS policies...")
      await client.query(sql)
      console.log("  ✓ Workflow & comment RLS policies applied")
    }

    // 2. Storage RLS Policies
    const storageMigrationPath = path.join(__dirname, "../supabase/migrations/add_storage_rls_policies.sql")
    if (fs.existsSync(storageMigrationPath)) {
      const sql = fs.readFileSync(storageMigrationPath, "utf-8")
      console.log("  Applying storage RLS policies...")
      await client.query(sql)
      console.log("  ✓ Storage RLS policies applied")
    }

    await client.end()
    console.log("\n✅ All RLS policies successfully applied!")
    process.exit(0)
  } catch (err) {
    console.error("\n❌ Error applying RLS policies:")
    console.error(`   ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

applyRLSPolicies()
