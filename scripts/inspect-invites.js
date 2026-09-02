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

async function checkInvites() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  const { default: pg } = await import("pg")
  const client = new pg.Client({
    connectionString: postgresUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  const { rows } = await client.query("SELECT * FROM project_invites LIMIT 10")
  console.log("Current project_invites rows:", rows)

  const { rows: cols } = await client.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'project_invites'
  `)
  console.log("Columns of project_invites:", cols)

  await client.end()
}

checkInvites()
