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

async function testAccept() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  const { default: pg } = await import("pg")
  const client = new pg.Client({
    connectionString: postgresUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  const { rows: users } = await client.query("SELECT id, email FROM auth.users LIMIT 5")
  console.log("Auth users:", users)

  const { rows: invites } = await client.query("SELECT token, invitee_email, project_id FROM project_invites LIMIT 5")
  console.log("Invites:", invites)

  if (users.length > 0 && invites.length > 0) {
    try {
      // Simulate calling accept_project_invite as the user
      await client.query(`SET LOCAL "request.jwt.claim.sub" = '${users[0].id}'`)
      await client.query(`SET LOCAL "request.jwt.claim.email" = '${users[0].email}'`)
      await client.query(`SET LOCAL "request.jwt.claim.role" = 'authenticated'`)
      await client.query(`SET LOCAL ROLE authenticated`)

      const res = await client.query(`SELECT public.accept_project_invite($1) as result`, [invites[0].token])
      console.log("Accept result:", res.rows[0])
    } catch (err) {
      console.error("RPC call failed:", err.message)
    }
  }

  await client.end()
}

testAccept()
