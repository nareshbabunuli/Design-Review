import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

async function inspectHooperProject() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  const { default: pg } = await import("pg")
  const client = new pg.Client({
    connectionString: postgresUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  const { rows: projects } = await client.query("SELECT id, title, user_id FROM projects")
  console.log("All projects:", projects)

  const { rows: members } = await client.query("SELECT * FROM project_members")
  console.log("All project members:", members)

  const { rows: invites } = await client.query("SELECT * FROM project_invites")
  console.log("All project invites:", invites)

  await client.end()
}

inspectHooperProject()
