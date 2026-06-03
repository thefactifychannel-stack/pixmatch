
-- 1) Tighten guest_sessions: no public read
DROP POLICY IF EXISTS "anyone read guest session" ON public.guest_sessions;
DROP POLICY IF EXISTS "anyone create guest session" ON public.guest_sessions;
-- Only event owners can see sessions for their events (admin/service_role bypasses RLS)
CREATE POLICY "owner read sessions"
ON public.guest_sessions
FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = guest_sessions.event_id AND e.owner_id = auth.uid()));

-- 2) Tighten guest_matches
DROP POLICY IF EXISTS "anyone read matches" ON public.guest_matches;
DROP POLICY IF EXISTS "anyone insert matches" ON public.guest_matches;
CREATE POLICY "owner read matches"
ON public.guest_matches
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.guest_sessions s
  JOIN public.events e ON e.id = s.event_id
  WHERE s.id = guest_matches.session_id AND e.owner_id = auth.uid()
));

-- 3) Tighten favorites
DROP POLICY IF EXISTS "anyone read favorites" ON public.favorites;
DROP POLICY IF EXISTS "anyone delete favorites" ON public.favorites;
DROP POLICY IF EXISTS "anyone toggle favorites" ON public.favorites;
CREATE POLICY "owner read favorites"
ON public.favorites
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.guest_sessions s
  JOIN public.events e ON e.id = s.event_id
  WHERE s.id = favorites.session_id AND e.owner_id = auth.uid()
));

-- 4) Tighten photo_faces (biometric data)
DROP POLICY IF EXISTS "public read faces" ON public.photo_faces;
-- Only owner policy remains (already exists)

-- 5) Selfies bucket: drop unrestricted upload (not used by client anymore)
DROP POLICY IF EXISTS "anyone upload selfie" ON storage.objects;

-- 6) Photos bucket: restrict listing to active events' folders
DROP POLICY IF EXISTS "public read photos bucket" ON storage.objects;
CREATE POLICY "public read photos active events"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'photos'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.active = true
      AND e.id::text = (storage.foldername(name))[1]
  )
);

-- 7) Revoke EXECUTE on SECURITY DEFINER helpers from public/anon/authenticated
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
