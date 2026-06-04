DROP POLICY IF EXISTS "authenticated upload photos" ON storage.objects;
CREATE POLICY "authenticated upload photos" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'photos'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id::text = (storage.foldername(name))[1]
      AND e.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "public read photos active events" ON storage.objects;
CREATE POLICY "public read photos active events" ON storage.objects
FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'photos'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.active = true
      AND e.id::text = (storage.foldername(name))[1]
  )
);