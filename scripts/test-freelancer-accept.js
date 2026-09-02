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

async function testAll() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  const { default: pg } = await import("pg")
  const client = new pg.Client({
    connectionString: postgresUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  const { rows: users } = await client.query("SELECT id, email FROM auth.users WHERE email = 'nareshbabu.nuli@gmail.com'")
  const user = users[0]

  const { rows: freelancerInvite } = await client.query("SELECT token FROM project_invites WHERE role = 'freelancer' LIMIT 1")
  const token = freelancerInvite[0].token

  console.log("Testing accept as Freelancer:", user.email, "token:", token)

  await client.query(`
    SELECT set_config('request.jwt.claims', '{"sub": "${user.id}", "email": "${user.email}", "role": "authenticated"}', true);
  `)
  await client.query(`SET LOCAL ROLE authenticated`)

  const res = await client.query(`SELECT public.accept_project_invite($1) as result`, [token])
  console.log("✓ Success result:", res.rows[0].result)

  await client.end()
}

testAll()
