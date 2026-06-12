import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Heart, Download, Share2, X, ArrowLeft, AlertCircle, Camera, Lightbulb, RefreshCw, CheckSquare, Square } from "lucide-react";
import { publicPhotoUrl } from "@/lib/storage-url";
import { getGuestGallery, toggleGuestFavorite } from "@/lib/guest.functions";
import JSZip from "jszip";

type Match = {
  photo_id: string;
  confidence: number;
  photos: {
    id: string;
    thumb_path: string | null;
    preview_path: string | null;
    storage_path: string;
    quality_score: number | null;
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
  const [tab, setTab] = useState<"best" | "all" | "lowlight" | "favorites">("best");
  const [viewer, setViewer] = useState<string | null>(null);
  const [totalEventPhotos, setTotalEventPhotos] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number; phase: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getGuestGallery({ data: { slug, token } });
        setEvent(res.event as EventRow);
        setTotalEventPhotos(res.totalEventPhotos);
        setSessionId(res.sessionId);
        setMatches(res.matches as Match[]);
        setFavorites(new Set(res.favorites));
        setLoadError(null);
      } catch (e) {
        console.error(e);
        setLoadError(e instanceof Error ? e.message : "Gallery could not load");
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

  // Buckets:
  //   best     -> confidence >= 0.55 AND quality_score >= 0.55 (good light + sharp)
  //   lowlight -> quality_score < 0.4 (or null) — kept out of Best
  //   all      -> every match
  const buckets = useMemo(() => {
    const best: Match[] = [];
    const low: Match[] = [];
    for (const m of matches) {
      const q = m.photos?.quality_score ?? null;
      if (q !== null && q < 0.4) low.push(m);
      if (m.confidence >= 0.55 && (q === null || q >= 0.55)) best.push(m);
    }
    return { best, low };
  }, [matches]);

  const counts = {
    all: matches.length,
    best: buckets.best.length,
    lowlight: buckets.low.length,
    favorites: matches.filter((m) => favorites.has(m.photo_id)).length,
  };

  const displayed = useMemo(() => {
    if (tab === "best") return buckets.best;
    if (tab === "lowlight") return buckets.low;
    if (tab === "favorites") return matches.filter((m) => favorites.has(m.photo_id));
    return matches;
  }, [matches, favorites, tab, buckets]);

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

  function filenameFromPath(path: string, fallback: string): string {
    const last = path.split("/").pop() || fallback;
    return last.replace(/[^\w.\-]+/g, "_");
  }

  async function downloadSingle(path: string) {
    const url = publicPhotoUrl(path);
    const name = filenameFromPath(path, "photo.jpg");
    try {
      toast.loading("Preparing download…", { id: "dl" });
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      triggerBlobDownload(blob, name);
      toast.success("Download started", { id: "dl" });
    } catch (e) {
      console.error(e);
      toast.error("Unable to download image. Please try again.", { id: "dl" });
    }
  }

  function triggerBlobDownload(blob: Blob, filename: string) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  function safeEventName(): string {
    return (event?.name ?? "photos").replace(/[^\w\-]+/g, "_");
  }

  async function downloadZip(items: Match[], zipLabel: string) {
    if (!event?.downloads_enabled) {
      toast.error("Downloads are disabled for this event");
      return;
    }
    const photos = items.map((m) => m.photos).filter((p): p is NonNullable<Match["photos"]> => !!p);
    if (photos.length === 0) {
      toast.error("Nothing to download");
      return;
    }
    const zip = new JSZip();
    setZipProgress({ current: 0, total: photos.length, phase: "Preparing download…" });
    let done = 0;
    let failed = 0;
    try {
      // Sequential fetch keeps memory + bandwidth reasonable on mobile
      for (const p of photos) {
        try {
          const res = await fetch(publicPhotoUrl(p.storage_path), { mode: "cors" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          zip.file(filenameFromPath(p.storage_path, `${p.id}.jpg`), blob);
        } catch (e) {
          console.error("photo fetch failed", p.storage_path, e);
          failed++;
        }
        done++;
        setZipProgress({ current: done, total: photos.length, phase: `Downloading ${done}/${photos.length}…` });
      }
      setZipProgress({ current: done, total: photos.length, phase: "Generating ZIP archive…" });
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (meta) => {
        setZipProgress({ current: done, total: photos.length, phase: `Generating ZIP ${Math.round(meta.percent)}%` });
      });
      triggerBlobDownload(blob, `${safeEventName()}_${zipLabel}.zip`);
      if (failed > 0) toast.warning(`Download ready (${failed} photos could not be included)`);
      else toast.success("Download complete");
    } catch (e) {
      console.error(e);
      toast.error("ZIP generation failed. Please try again.");
    } finally {
      setZipProgress(null);
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  if (!event) {
    if (loadError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="max-w-sm text-center">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
            <h1 className="font-semibold text-lg">Gallery couldn't load</h1>
            <p className="text-sm text-muted-foreground mt-2">{loadError}</p>
            <a href={`/e/${slug}`} className="inline-flex items-center gap-2 mt-6 text-sm text-primary hover:underline">
              <RefreshCw className="h-4 w-4" />
              Search again
            </a>
          </div>
        </div>
      );
    }
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

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
        <div className="container mx-auto px-4 pb-3 flex gap-2 overflow-x-auto">
          {(["best", "all", "lowlight", "favorites"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-sm transition ${tab === t ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"}`}
            >
              {t === "best" ? `Best · ${counts.best}` : t === "all" ? `All · ${counts.all}` : t === "lowlight" ? `Low Light · ${counts.lowlight}` : `Favourites · ${counts.favorites}`}
            </button>
          ))}
        </div>
        {event.downloads_enabled && (
          <div className="container mx-auto px-4 pb-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={selectMode ? "default" : "secondary"}
              onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
            >
              {selectMode ? <CheckSquare className="h-4 w-4 mr-1" /> : <Square className="h-4 w-4 mr-1" />}
              {selectMode ? `Selected ${selected.size}` : "Select"}
            </Button>
            {selectMode && selected.size > 0 && (
              <Button size="sm" onClick={() => downloadZip(matches.filter((m) => selected.has(m.photo_id)), "Selected")}>
                <Download className="h-4 w-4 mr-1" /> Download selected ({selected.size})
              </Button>
            )}
            {!selectMode && counts.favorites > 0 && (
              <Button size="sm" variant="secondary" onClick={() => downloadZip(matches.filter((m) => favorites.has(m.photo_id)), "Favourites")}>
                <Download className="h-4 w-4 mr-1" /> Download favourites ({counts.favorites})
              </Button>
            )}
            {!selectMode && counts.all > 0 && (
              <Button size="sm" variant="secondary" onClick={() => downloadZip(matches, "AllPhotos")}>
                <Download className="h-4 w-4 mr-1" /> Download all ({counts.all})
              </Button>
            )}
          </div>
        )}
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="mb-6 rounded-xl border border-border bg-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <SummaryStat label="Photos scanned" value={(totalEventPhotos ?? 0).toLocaleString()} />
          <SummaryStat label="Matches" value={counts.all.toString()} accent />
          <SummaryStat label="Best" value={counts.best.toString()} />
          <SummaryStat label="Low Light" value={counts.lowlight.toString()} />
        </div>
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
              <button
                key={m.photo_id}
                onClick={() => selectMode ? toggleSelect(m.photo_id) : setViewer(m.photo_id)}
                className={`relative aspect-square rounded-lg overflow-hidden bg-muted group ${selectMode && selected.has(m.photo_id) ? "ring-2 ring-primary" : ""}`}
              >
                <img src={publicPhotoUrl(m.photos.thumb_path ?? m.photos.storage_path)} loading="lazy" alt="" className="w-full h-full object-cover transition group-hover:scale-105" />
                {favorites.has(m.photo_id) && (
                  <Heart className="absolute top-2 right-2 h-5 w-5 fill-primary text-primary drop-shadow" />
                )}
                {m.confidence < 0.7 && (
                  <span className="absolute bottom-2 left-2 text-[10px] bg-black/60 text-white px-2 py-0.5 rounded">Maybe</span>
                )}
                {selectMode && (
                  <span className={`absolute top-2 left-2 h-6 w-6 rounded-md flex items-center justify-center ${selected.has(m.photo_id) ? "bg-primary text-primary-foreground" : "bg-black/50 text-white"}`}>
                    {selected.has(m.photo_id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </main>

      {zipProgress && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-card border border-border rounded-xl shadow-lg px-4 py-3 w-[90%] max-w-sm">
          <p className="text-sm font-medium">{zipProgress.phase}</p>
          <div className="mt-2 h-2 bg-secondary rounded overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${zipProgress.total ? Math.round((zipProgress.current / zipProgress.total) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

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
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); downloadSingle(viewerMatch.photos!.storage_path); }}
              >
                <Download className="h-5 w-5 text-white" />
              </Button>
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
  tab: "best" | "all" | "lowlight" | "favorites";
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

  if (tab === "lowlight") {
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center">
        <Lightbulb className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground font-medium">No low-light photos</p>
        <p className="text-sm text-muted-foreground mt-1">All your matches are crisp and well-lit.</p>
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

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${accent ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}