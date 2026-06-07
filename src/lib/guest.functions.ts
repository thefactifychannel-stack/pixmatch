import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function euclidean(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function distanceToConfidence(d: number): number {
  // mirrors src/lib/face.ts
  if (d <= 0.3) return 1;
  if (d >= 0.65) return 0;
  return 1 - (d - 0.3) / (0.65 - 0.3);
}

const matchInput = z.object({
  slug: z.string().min(1).max(255),
  // Legacy single embedding (kept for back-compat)
  embedding: z.array(z.number()).min(64).max(1024).optional(),
  // New: one embedding per face detected in the selfie
  embeddings: z.array(z.array(z.number()).min(64).max(1024)).min(1).max(8).optional(),
});

export const matchGuestSelfie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const parsed = matchInput.parse(d);
    const embs =
      parsed.embeddings && parsed.embeddings.length > 0
        ? parsed.embeddings
        : parsed.embedding
          ? [parsed.embedding]
          : null;
    if (!embs) throw new Error("No face embedding provided");
    return { slug: parsed.slug, embeddings: embs };
  })
  .handler(async ({ data }) => {
    const supabaseAdmin = await getAdminClient();
    const { data: ev, error: evErr } = await supabaseAdmin
      .from("events")
      .select("id")
      .eq("slug", data.slug)
      .eq("active", true)
      .maybeSingle();
    if (evErr) throw new Error("Event lookup failed");
    if (!ev) throw new Error("Event not found");

    const { data: faces, error: fErr } = await supabaseAdmin
      .from("photo_faces")
      .select("photo_id, embedding")
      .eq("event_id", ev.id);
    if (fErr) throw new Error("Face lookup failed");

    // For each face in the selfie, find best distance per photo. A photo
    // matches if ANY selfie face is close enough to ANY face in the photo.
    const best = new Map<string, number>();
    for (const f of faces ?? []) {
      const emb = f.embedding as unknown as number[];
      if (!Array.isArray(emb)) continue;
      let bestD = Infinity;
      for (const q of data.embeddings) {
        const d = euclidean(q, emb);
        if (d < bestD) bestD = d;
      }
      const cur = best.get(f.photo_id);
      if (cur === undefined || bestD < cur) best.set(f.photo_id, bestD);
    }
    const matches = Array.from(best.entries())
      .filter(([, d]) => d < 0.65)
      .map(([photo_id, d]) => ({ photo_id, confidence: distanceToConfidence(d) }));

    // Count total photos scanned in this event
    const { count: totalScanned } = await supabaseAdmin
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("event_id", ev.id)
      .eq("status", "published");

    const token = crypto.randomUUID().replace(/-/g, "");
    const { data: session, error: sErr } = await supabaseAdmin
      .from("guest_sessions")
      .insert({ event_id: ev.id, token })
      .select("id, token")
      .single();
    if (sErr || !session) throw new Error("Could not create guest session");

    if (matches.length > 0) {
      await supabaseAdmin.from("guest_matches").insert(
        matches.map((m) => ({
          session_id: session.id,
          photo_id: m.photo_id,
          confidence: m.confidence,
        })),
      );
    }
    return {
      token: session.token,
      matchCount: matches.length,
      peopleDetected: data.embeddings.length,
      totalScanned: totalScanned ?? 0,
    };
  });

const tokenSchema = z.string().min(16).max(64).regex(/^[a-zA-Z0-9]+$/);

export const getGuestGallery = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ slug: z.string().min(1).max(255), token: tokenSchema }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabaseAdmin = await getAdminClient();
    const { data: ev } = await supabaseAdmin
      .from("events")
      .select("id, name, downloads_enabled")
      .eq("slug", data.slug)
      .eq("active", true)
      .maybeSingle();
    if (!ev) throw new Error("Event not found");

    const { data: sess } = await supabaseAdmin
      .from("guest_sessions")
      .select("id, event_id")
      .eq("token", data.token)
      .maybeSingle();
    if (!sess || sess.event_id !== ev.id) throw new Error("Invalid session");

    const [{ count: photoCount }, { data: matches }, { data: favs }] = await Promise.all([
      supabaseAdmin
        .from("photos")
        .select("id", { count: "exact", head: true })
        .eq("event_id", ev.id)
        .eq("status", "published"),
      supabaseAdmin
        .from("guest_matches")
        .select("photo_id, confidence, photos(id,thumb_path,preview_path,storage_path,quality_score)")
        .eq("session_id", sess.id)
        .order("confidence", { ascending: false }),
      supabaseAdmin.from("favorites").select("photo_id").eq("session_id", sess.id),
    ]);

    return {
      event: ev,
      sessionId: sess.id,
      totalEventPhotos: photoCount ?? 0,
      matches: matches ?? [],
      favorites: (favs ?? []).map((f) => f.photo_id),
    };
  });

export const toggleGuestFavorite = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: tokenSchema,
        photoId: z.string().uuid(),
        on: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const supabaseAdmin = await getAdminClient();
    const { data: sess } = await supabaseAdmin
      .from("guest_sessions")
      .select("id")
      .eq("token", data.token)
      .maybeSingle();
    if (!sess) throw new Error("Invalid session");

    if (data.on) {
      await supabaseAdmin
        .from("favorites")
        .insert({ session_id: sess.id, photo_id: data.photoId });
    } else {
      await supabaseAdmin
        .from("favorites")
        .delete()
        .eq("session_id", sess.id)
        .eq("photo_id", data.photoId);
    }
    return { ok: true };
  });