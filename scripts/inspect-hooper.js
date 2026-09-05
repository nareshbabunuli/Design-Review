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

  const { rows: workflows } = await client.query("SELECT id, title, design_a, design_b FROM workflows WHERE project_id = 'a02d0105-4c34-4a23-820b-7c5242fdf454' ORDER BY created_at ASC LIMIT 5")
  console.log("Workflows:", workflows)

  await client.end()
}

inspectHooperProject()
