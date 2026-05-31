
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'photographer');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  business_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile write" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roles read" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Auto-create profile + default photographer role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name) VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'photographer');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Events
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  downloads_enabled BOOLEAN NOT NULL DEFAULT true,
  watermark_enabled BOOLEAN NOT NULL DEFAULT false,
  watermark_text TEXT,
  review_mode BOOLEAN NOT NULL DEFAULT false,
  ai_strictness TEXT NOT NULL DEFAULT 'balanced',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT SELECT ON public.events TO anon;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read active events" ON public.events FOR SELECT USING (active = true);
CREATE POLICY "owner read all" ON public.events FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "owner insert" ON public.events FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "owner update" ON public.events FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "owner delete" ON public.events FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Photos
CREATE TABLE public.photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  thumb_path TEXT,
  preview_path TEXT,
  status TEXT NOT NULL DEFAULT 'published', -- published | pending | flagged
  quality_score REAL,
  face_count INT NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX photos_event_idx ON public.photos(event_id, uploaded_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photos TO authenticated;
GRANT SELECT ON public.photos TO anon;
GRANT ALL ON public.photos TO service_role;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all photos" ON public.photos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.owner_id = auth.uid()));
-- Guests/anon can read published photos of active events (still gated client-side by matched set)
CREATE POLICY "public read published" ON public.photos FOR SELECT
  USING (status = 'published' AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.active));

-- Face embeddings
CREATE TABLE public.photo_faces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  embedding REAL[] NOT NULL,
  box JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX photo_faces_event_idx ON public.photo_faces(event_id);
GRANT SELECT, INSERT, DELETE ON public.photo_faces TO authenticated;
GRANT SELECT ON public.photo_faces TO anon;
GRANT ALL ON public.photo_faces TO service_role;
ALTER TABLE public.photo_faces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manage faces" ON public.photo_faces FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.owner_id = auth.uid()));
CREATE POLICY "public read faces" ON public.photo_faces FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.active));

-- Guest sessions
CREATE TABLE public.guest_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days')
);
GRANT SELECT, INSERT ON public.guest_sessions TO anon, authenticated;
GRANT ALL ON public.guest_sessions TO service_role;
ALTER TABLE public.guest_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone create guest session" ON public.guest_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone read guest session" ON public.guest_sessions FOR SELECT USING (true);

-- Guest matches
CREATE TABLE public.guest_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.guest_sessions(id) ON DELETE CASCADE,
  photo_id UUID NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  confidence REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, photo_id)
);
CREATE INDEX guest_matches_session_idx ON public.guest_matches(session_id);
GRANT SELECT, INSERT, DELETE ON public.guest_matches TO anon, authenticated;
GRANT ALL ON public.guest_matches TO service_role;
ALTER TABLE public.guest_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read matches" ON public.guest_matches FOR SELECT USING (true);
CREATE POLICY "anyone insert matches" ON public.guest_matches FOR INSERT WITH CHECK (true);

-- Favorites
CREATE TABLE public.favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.guest_sessions(id) ON DELETE CASCADE,
  photo_id UUID NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, photo_id)
);
CREATE INDEX favorites_photo_idx ON public.favorites(photo_id);
GRANT SELECT, INSERT, DELETE ON public.favorites TO anon, authenticated;
GRANT ALL ON public.favorites TO service_role;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read favorites" ON public.favorites FOR SELECT USING (true);
CREATE POLICY "anyone toggle favorites" ON public.favorites FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone delete favorites" ON public.favorites FOR DELETE USING (true);

-- Storage bucket for photos (public read for MVP simplicity)
INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', true)
  ON CONFLICT (id) DO NOTHING;

-- Storage policies: owner uploads, public reads
CREATE POLICY "public read photos bucket" ON storage.objects FOR SELECT
  USING (bucket_id = 'photos');
CREATE POLICY "authenticated upload photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos');
CREATE POLICY "owner update photos" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'photos' AND owner = auth.uid());
CREATE POLICY "owner delete photos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'photos' AND owner = auth.uid());

-- Selfies bucket (private; only used transiently)
INSERT INTO storage.buckets (id, name, public) VALUES ('selfies', 'selfies', false)
  ON CONFLICT (id) DO NOTHING;
CREATE POLICY "anyone upload selfie" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'selfies');
