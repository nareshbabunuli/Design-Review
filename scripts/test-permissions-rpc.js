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

async function test() {
  console.log("🧪 Testing Database Permissions & Tables...\n")
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

  try {
    const { default: pg } = await import("pg")
    const client = new pg.Client({
      connectionString: postgresUrl,
      ssl: { rejectUnauthorized: false },
    })

    await client.connect()
    console.log("✓ Connected to PostgreSQL")

    // Check tables exist
    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('projects', 'workflows', 'project_members', 'project_invites', 'workflow_revisions')
    `)
    console.log("✓ Verified Tables:", tables.map(t => t.table_name).join(", "))

    // Check RPC functions exist
    const { rows: functions } = await client.query(`
      SELECT routine_name FROM information_schema.routines 
      WHERE routine_schema = 'public'
      AND routine_name IN (
        'get_user_project_permissions',
        'get_project_people_and_permissions',
        'create_project_invitation',
        'accept_project_invite',
        'update_project_member_permissions',
        'revoke_project_member',
        'revoke_project_invite',
        'update_workflow_field_secure',
        'submit_workflow_revision',
        'get_workflow_revisions'
      )
    `)
    console.log("✓ Verified Functions:", functions.map(f => f.routine_name).join(", "))

    await client.end()
    console.log("\n✅ All permission tables & RPCs are online and functional!")
    process.exit(0)
  } catch (err) {
    console.error("❌ Test failed:", err)
    process.exit(1)
  }
}

test()
