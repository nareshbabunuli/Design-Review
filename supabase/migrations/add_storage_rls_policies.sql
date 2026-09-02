-- Storage Row Level Security (RLS) Policies for 'designs' bucket
-- These policies allow public read access and permit authenticated and anonymous users to upload/update/delete designs
-- Note: RLS is already enabled on storage.objects by default in Supabase.

-- Drop existing policies if they exist to avoid duplicate policy errors
DROP POLICY IF EXISTS "Allow public read access on designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated and anon uploads to designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated and anon updates to designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated and anon deletes from designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from designs" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;

-- 1. Allow public read access to images in 'designs' bucket
CREATE POLICY "Allow public read access on designs"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'designs');

-- 2. Allow authenticated and anonymous users to upload images to 'designs' bucket
CREATE POLICY "Allow authenticated and anon uploads to designs"
ON storage.objects FOR INSERT
TO authenticated, anon
WITH CHECK (bucket_id = 'designs');

-- 3. Allow updating uploaded images (required for upsert: true)
CREATE POLICY "Allow authenticated and anon updates to designs"
ON storage.objects FOR UPDATE
TO authenticated, anon
USING (bucket_id = 'designs')
WITH CHECK (bucket_id = 'designs');

-- 4. Allow deleting images from 'designs' bucket
CREATE POLICY "Allow authenticated and anon deletes from designs"
ON storage.objects FOR DELETE
TO authenticated, anon
USING (bucket_id = 'designs');
