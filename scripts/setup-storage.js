import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createClient } from "@supabase/supabase-js"

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const postgresUrl = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Missing environment variables:")
  console.error("   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")
  console.error("\n   Make sure .env.local exists with valid Supabase credentials")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
})

async function setupStorage() {
  console.log("🚀 Setting up Supabase Storage buckets & policies...\n")

  try {
    // 1. Create designs bucket
    console.log("  Creating 'designs' bucket...")
    const { data, error } = await supabase.storage.createBucket("designs", {
      public: true,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      fileSizeLimit: 52428800, // 50MB
    })

    if (error) {
      if (error.message?.includes("already exists")) {
        console.log("  ✓ 'designs' bucket already exists")
      } else {
        throw error
      }
    } else if (data) {
      console.log("  ✓ Created 'designs' bucket")
    }

    // 2. Apply Storage RLS Policies via direct PostgreSQL connection if available
    if (postgresUrl) {
      console.log("\n  Applying Storage Row Level Security (RLS) policies to PostgreSQL...")
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
      try {
        const { default: pg } = await import("pg")
        const client = new pg.Client({
          connectionString: postgresUrl,
          ssl: { rejectUnauthorized: false },
        })

        await client.connect()

        const migrationPath = path.join(__dirname, "../supabase/migrations/add_storage_rls_policies.sql")
        let sql = ""
        if (fs.existsSync(migrationPath)) {
          sql = fs.readFileSync(migrationPath, "utf-8")
        } else {
          sql = `
            ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
            DROP POLICY IF EXISTS "Allow public read access on designs" ON storage.objects;
            DROP POLICY IF EXISTS "Allow authenticated and anon uploads to designs" ON storage.objects;
            DROP POLICY IF EXISTS "Allow authenticated and anon updates to designs" ON storage.objects;
            DROP POLICY IF EXISTS "Allow authenticated and anon deletes from designs" ON storage.objects;
            CREATE POLICY "Allow public read access on designs" ON storage.objects FOR SELECT TO public USING (bucket_id = 'designs');
            CREATE POLICY "Allow authenticated and anon uploads to designs" ON storage.objects FOR INSERT TO authenticated, anon WITH CHECK (bucket_id = 'designs');
            CREATE POLICY "Allow authenticated and anon updates to designs" ON storage.objects FOR UPDATE TO authenticated, anon USING (bucket_id = 'designs') WITH CHECK (bucket_id = 'designs');
            CREATE POLICY "Allow authenticated and anon deletes from designs" ON storage.objects FOR DELETE TO authenticated, anon USING (bucket_id = 'designs');
          `
        }

        await client.query(sql)
        await client.end()
        console.log("  ✓ Applied Storage RLS policies for 'designs' bucket")
      } catch (dbErr) {
        console.warn("  ⚠️  Could not apply RLS policies automatically via PostgreSQL:", dbErr instanceof Error ? dbErr.message : dbErr)
        console.log("  ℹ️  Please run 'supabase/migrations/add_storage_rls_policies.sql' manually in your Supabase SQL Editor.")
      }
    } else {
      console.log("\n  ℹ️  POSTGRES_URL not found. Run 'supabase/migrations/add_storage_rls_policies.sql' in your Supabase SQL Editor to enable RLS policies.")
    }

    console.log("\n✅ Storage setup complete!")
    process.exit(0)
  } catch (err) {
    console.error("\n❌ Storage setup failed:")
    console.error(`   ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

setupStorage()
