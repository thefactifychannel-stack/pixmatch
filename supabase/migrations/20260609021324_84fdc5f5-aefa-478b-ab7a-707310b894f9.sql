
DROP POLICY IF EXISTS "authenticated upload photos" ON storage.objects;
DROP POLICY IF EXISTS "public read photos active events" ON storage.objects;
DROP POLICY IF EXISTS "owner update photos" ON storage.objects;
DROP POLICY IF EXISTS "owner delete photos" ON storage.objects;

CREATE POLICY "authenticated upload photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'photos'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id::text = (storage.foldername(storage.objects.name))[1]
      AND e.owner_id = auth.uid()
  )
);

CREATE POLICY "public read photos active events"
ON storage.objects FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'photos'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.active = true
      AND e.id::text = (storage.foldername(storage.objects.name))[1]
  )
);

CREATE POLICY "owner update photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'photos'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id::text = (storage.foldername(storage.objects.name))[1]
      AND e.owner_id = auth.uid()
  )
);

CREATE POLICY "owner delete photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'photos'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id::text = (storage.foldername(storage.objects.name))[1]
      AND e.owner_id = auth.uid()
  )
);
