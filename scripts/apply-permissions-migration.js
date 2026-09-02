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

async function run() {
  console.log("🚀 Applying Comprehensive Permissions Migration...\n")

  if (!postgresUrl) {
    console.error("❌ POSTGRES_URL or POSTGRES_URL_NON_POOLING is missing from .env.local")
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

    const migrationPath = path.join(__dirname, "../supabase/migrations/add_comprehensive_permissions.sql")
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, "utf-8")
      console.log("  Executing add_comprehensive_permissions.sql...")
      await client.query(sql)
      console.log("  ✓ Migration successfully applied!")
    } else {
      console.error("  ❌ Migration file not found:", migrationPath)
    }

    await client.end()
    console.log("\n✅ Done!")
    process.exit(0)
  } catch (err) {
    console.error("\n❌ Error running migration:")
    console.error(`   ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

run()
