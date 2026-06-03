import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Heart, Download, Share2, X, ArrowLeft, AlertCircle, Camera, Lightbulb, RefreshCw } from "lucide-react";
import { publicPhotoUrl } from "@/lib/storage-url";
import { getGuestGallery, toggleGuestFavorite } from "@/lib/guest.functions";

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
  const [totalEventPhotos, setTotalEventPhotos] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getGuestGallery({ data: { slug, token } });
        setEvent(res.event as EventRow);
        setTotalEventPhotos(res.totalEventPhotos);
        setSessionId(res.sessionId);
        setMatches(res.matches as Match[]);
        setFavorites(new Set(res.favorites));
      } catch (e) {
        console.error(e);
      }
    })();
  }, [slug, token]);

  async function toggleFav(photoId: string) {
    if (!sessionId) return;
    const next = new Set(favorites);
    if (next.has(photoId)) {
      next.delete(photoId);
      setFavorites(next);
      await toggleGuestFavorite({ data: { token, photoId, on: false } });
    } else {
      next.add(photoId);
      setFavorites(next);
      await toggleGuestFavorite({ data: { token, photoId, on: true } });
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
          <EmptyState
            tab={tab}
            matches={matches}
            totalEventPhotos={totalEventPhotos}
            slug={slug}
          />
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

function EmptyState({
  tab,
  matches,
  totalEventPhotos,
  slug,
}: {
  tab: "best" | "all" | "favorites";
  matches: Match[];
  totalEventPhotos: number | null;
  slug: string;
}) {
  if (tab === "favorites") {
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center">
        <Heart className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground font-medium">No favorites yet</p>
        <p className="text-sm text-muted-foreground mt-1">Tap the heart icon on photos you love to save them here.</p>
      </div>
    );
  }

  if (tab === "best" && matches.length > 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground font-medium">No high-confidence matches</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
          We found potential matches, but confidence is low. Try the <strong>All</strong> tab to see every possible match.
        </p>
        <div className="mt-4 text-left max-w-sm mx-auto bg-secondary/50 rounded-xl p-4 text-sm space-y-2">
          <p className="font-medium flex items-center gap-2"><Lightbulb className="h-4 w-4 text-primary shrink-0" />Why confidence might be low:</p>
          <ul className="list-disc pl-5 text-muted-foreground space-y-1">
            <li>Different lighting between your selfie and event photos</li>
            <li>Your face was partially turned or at an unusual angle</li>
            <li>Sunglasses, hats, or facial hair differences</li>
          </ul>
        </div>
      </div>
    );
  }

  if (tab === "all" && totalEventPhotos === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center">
        <Camera className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground font-medium">No photos in this event yet</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
          The event organizer hasn't uploaded any photos. Check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center">
      <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
      <p className="text-muted-foreground font-medium">No matches found</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
        We found your face, but couldn't match it to photos in this event. This can happen if you weren't in many photos, or if lighting and angles make matching difficult.
      </p>
      <div className="mt-4 text-left max-w-sm mx-auto bg-secondary/50 rounded-xl p-4 text-sm space-y-2">
        <p className="font-medium flex items-center gap-2"><Lightbulb className="h-4 w-4 text-primary shrink-0" />Tips for better results:</p>
        <ul className="list-disc pl-5 text-muted-foreground space-y-1">
          <li>Use a well-lit, front-facing selfie with a neutral expression</li>
          <li>Remove sunglasses, hats, or anything covering your face</li>
          <li>Make sure your face fills most of the frame</li>
          <li>Try again with a different photo if you have one</li>
        </ul>
      </div>
      <a href={`/e/${slug}`} className="inline-flex items-center gap-2 mt-6 text-sm text-primary hover:underline">
        <RefreshCw className="h-4 w-4" />
        Try a different selfie
      </a>
    </div>
  );
}