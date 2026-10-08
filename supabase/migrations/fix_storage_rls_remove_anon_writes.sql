-- Security fix: remove anonymous write/delete on the designs bucket.
-- Keep public READ so design images remain viewable via public URLs.
-- Authenticated users may still upload/update/delete under path conventions.

DROP POLICY IF EXISTS "Allow authenticated and anon uploads to designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated and anon updates to designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated and anon deletes from designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to designs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from designs" ON storage.objects;

-- Public read (unchanged intent)
DROP POLICY IF EXISTS "Allow public read access on designs" ON storage.objects;
CREATE POLICY "Allow public read access on designs"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'designs');

-- Authenticated-only writes
CREATE POLICY "Authenticated uploads to designs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'designs');

CREATE POLICY "Authenticated updates to designs"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'designs')
WITH CHECK (bucket_id = 'designs');

CREATE POLICY "Authenticated deletes from designs"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'designs');
