import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Heart, Download, Share2, X, ArrowLeft } from "lucide-react";
import { publicPhotoUrl } from "@/lib/storage-url";

type Match = {
  photo_id: string;
  confidence: number;
  photos: {
    id: string;
    thumb_path: string | null;
    preview_path: string | null;
    storage_path: string;
  } | null;
};

type EventRow = { id: string; name: string; downloads_enabled: boolean };

export const Route = createFileRoute("/e/$slug/gallery/$token")({
  head: () => ({ meta: [{ title: "Your photos — PhotoFlow" }] }),
  component: GuestGallery,
});

function GuestGallery() {
  const { slug, token } = Route.useParams();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"best" | "all" | "favorites">("best");
  const [viewer, setViewer] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: ev } = await supabase
        .from("events")
        .select("id,name,downloads_enabled")
        .eq("slug", slug)
        .maybeSingle();
      setEvent(ev);
      if (!ev) return;
      const { data: sess } = await supabase
        .from("guest_sessions")
        .select("id")
        .eq("token", token)
        .maybeSingle();
      if (!sess) return;
      setSessionId(sess.id);
      const { data: m } = await supabase
        .from("guest_matches")
        .select("photo_id, confidence, photos(id,thumb_path,preview_path,storage_path)")
        .eq("session_id", sess.id)
        .order("confidence", { ascending: false });
      setMatches((m ?? []) as Match[]);
      const { data: favs } = await supabase
        .from("favorites")
        .select("photo_id")
        .eq("session_id", sess.id);
      setFavorites(new Set((favs ?? []).map((f) => f.photo_id)));
    })();
  }, [slug, token]);

  async function toggleFav(photoId: string) {
    if (!sessionId) return;
    const next = new Set(favorites);
    if (next.has(photoId)) {
      next.delete(photoId);
      setFavorites(next);
      await supabase.from("favorites").delete().eq("session_id", sessionId).eq("photo_id", photoId);
    } else {
      next.add(photoId);
      setFavorites(next);
      await supabase.from("favorites").insert({ session_id: sessionId, photo_id: photoId });
    }
  }

  const displayed = useMemo(() => {
    if (tab === "best") return matches.filter((m) => m.confidence >= 0.55).slice(0, 24);
    if (tab === "favorites") return matches.filter((m) => favorites.has(m.photo_id));
    return matches;
  }, [matches, favorites, tab]);

  const viewerMatch = matches.find((m) => m.photo_id === viewer);

  async function share(path: string) {
    const url = publicPhotoUrl(path);
    if (navigator.share) {
      try { await navigator.share({ url, title: event?.name ?? "Photo" }); } catch { /* user cancel */ }
    } else {
      navigator.clipboard.writeText(url);
      toast.success("Link copied");
    }
  }

  if (!event) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-semibold">{event.name}</h1>
            <p className="text-xs text-muted-foreground">{matches.length} photos of you · {favorites.size} favorites</p>
          </div>
          <a href={`/e/${slug}`} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center"><ArrowLeft className="h-4 w-4 mr-1" />New search</a>
        </div>
        <div className="container mx-auto px-4 pb-3 flex gap-2">
          {(["best", "all", "favorites"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-full text-sm capitalize transition ${tab === t ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"}`}
            >
              {t === "best" ? "Best" : t === "all" ? "All" : "Favorites"}
            </button>
          ))}
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {displayed.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-16 text-center text-muted-foreground">
            {tab === "favorites" ? "No favorites yet. Tap the heart on photos you love." : "No matches yet."}
          </div>
        ) : (
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {displayed.map((m) => m.photos && (
              <button key={m.photo_id} onClick={() => setViewer(m.photo_id)} className="relative aspect-square rounded-lg overflow-hidden bg-muted group">
                <img src={publicPhotoUrl(m.photos.thumb_path ?? m.photos.storage_path)} loading="lazy" alt="" className="w-full h-full object-cover transition group-hover:scale-105" />
                {favorites.has(m.photo_id) && (
                  <Heart className="absolute top-2 right-2 h-5 w-5 fill-primary text-primary drop-shadow" />
                )}
                {m.confidence < 0.7 && (
                  <span className="absolute bottom-2 left-2 text-[10px] bg-black/60 text-white px-2 py-0.5 rounded">Maybe</span>
                )}
              </button>
            ))}
          </div>
        )}
      </main>

      {viewerMatch && viewerMatch.photos && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={() => setViewer(null)}>
          <div className="flex items-center justify-end p-4 gap-2" onClick={(e) => e.stopPropagation()}>
            <Button size="icon" variant="ghost" onClick={() => toggleFav(viewerMatch.photo_id)}>
              <Heart className={`h-5 w-5 ${favorites.has(viewerMatch.photo_id) ? "fill-primary text-primary" : "text-white"}`} />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => share(viewerMatch.photos!.storage_path)}>
              <Share2 className="h-5 w-5 text-white" />
            </Button>
            {event.downloads_enabled && (
              <a href={publicPhotoUrl(viewerMatch.photos.storage_path)} download target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                <Button size="icon" variant="ghost"><Download className="h-5 w-5 text-white" /></Button>
              </a>
            )}
            <Button size="icon" variant="ghost" onClick={() => setViewer(null)}>
              <X className="h-5 w-5 text-white" />
            </Button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <img src={publicPhotoUrl(viewerMatch.photos.preview_path ?? viewerMatch.photos.storage_path)} alt="" className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}