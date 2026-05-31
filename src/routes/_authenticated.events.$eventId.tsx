import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import QRCode from "qrcode";
import { PhotoUploader } from "@/components/photoflow/PhotoUploader";
import { publicPhotoUrl } from "@/lib/storage-url";
import { ArrowLeft, Download, Trash2, Heart } from "lucide-react";

type EventRow = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  downloads_enabled: boolean;
  watermark_enabled: boolean;
  review_mode: boolean;
};

type Photo = {
  id: string;
  thumb_path: string | null;
  preview_path: string | null;
  face_count: number;
  status: string;
};

export const Route = createFileRoute("/_authenticated/events/$eventId")({
  head: () => ({ meta: [{ title: "Event — PhotoFlow" }] }),
  component: EventDetail,
});

function EventDetail() {
  const { eventId } = Route.useParams();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [qrUrl, setQrUrl] = useState<string>("");
  const [stats, setStats] = useState({ favorites: 0, sessions: 0 });

  const guestUrl =
    typeof window !== "undefined" && event
      ? `${getShareableOrigin()}/e/${event.slug}`
      : "";

  const load = useCallback(async () => {
    const { data: e } = await supabase
      .from("events")
      .select("id,name,slug,active,downloads_enabled,watermark_enabled,review_mode")
      .eq("id", eventId)
      .maybeSingle();
    setEvent(e);
    const { data: p } = await supabase
      .from("photos")
      .select("id,thumb_path,preview_path,face_count,status")
      .eq("event_id", eventId)
      .order("uploaded_at", { ascending: false });
    setPhotos(p ?? []);
    const { count: favCount } = await supabase
      .from("favorites")
      .select("id", { count: "exact", head: true })
      .in("photo_id", (p ?? []).map((x) => x.id).length ? (p ?? []).map((x) => x.id) : ["00000000-0000-0000-0000-000000000000"]);
    const { count: sessCount } = await supabase
      .from("guest_sessions")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);
    setStats({ favorites: favCount ?? 0, sessions: sessCount ?? 0 });
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (guestUrl) {
      QRCode.toDataURL(guestUrl, { width: 320, margin: 2, color: { dark: "#1a1a1a", light: "#ffffff" } }).then(setQrUrl);
    }
  }, [guestUrl]);

  async function toggle(field: "active" | "downloads_enabled" | "watermark_enabled" | "review_mode", value: boolean) {
    if (!event) return;
    setEvent({ ...event, [field]: value });
    const patch: Partial<EventRow> = { [field]: value };
    const { error } = await supabase.from("events").update(patch).eq("id", event.id);
    if (error) toast.error(error.message);
  }

  async function deletePhoto(id: string) {
    if (!confirm("Delete this photo?")) return;
    const { error } = await supabase.from("photos").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPhotos((cur) => cur.filter((p) => p.id !== id));
  }

  if (!event) {
    return <main className="container mx-auto px-4 py-10 text-muted-foreground">Loading…</main>;
  }

  return (
    <main className="container mx-auto px-4 py-10">
      <Link to="/dashboard" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{event.name}</h1>
          <p className="text-muted-foreground mt-1">{photos.length} photos · {stats.sessions} guest sessions · {stats.favorites} favorites</p>
        </div>
        <PhotoUploader eventId={event.id} onUploaded={load} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3 mb-10">
        <div className="rounded-2xl border border-border bg-card p-6 lg:col-span-2">
          <h2 className="font-semibold mb-4">Guest access</h2>
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            {qrUrl && <img src={qrUrl} alt="Guest QR code" className="rounded-lg bg-white p-2" width={200} height={200} />}
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Guest URL</p>
                <code className="text-sm break-all">{guestUrl}</code>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(guestUrl); toast.success("Copied"); }}>
                  Copy link
                </Button>
                {qrUrl && (
                  <a href={qrUrl} download={`${event.slug}-qr.png`}>
                    <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" />QR PNG</Button>
                  </a>
                )}
                <a href={guestUrl} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm">Open guest page</Button>
                </a>
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h2 className="font-semibold">Settings</h2>
          <ToggleRow label="Active" desc="Guests can access this event" checked={event.active} onChange={(v) => toggle("active", v)} />
          <ToggleRow label="Downloads" desc="Allow guests to download originals" checked={event.downloads_enabled} onChange={(v) => toggle("downloads_enabled", v)} />
          <ToggleRow label="Watermark" desc="Show watermark on displayed images" checked={event.watermark_enabled} onChange={(v) => toggle("watermark_enabled", v)} />
          <ToggleRow label="Review mode" desc="Approve photos before publishing" checked={event.review_mode} onChange={(v) => toggle("review_mode", v)} />
        </div>
      </div>

      <h2 className="font-semibold mb-4">Gallery</h2>
      {photos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-16 text-center text-muted-foreground">
          No photos yet. Upload to get started.
        </div>
      ) : (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {photos.map((p) => (
            <div key={p.id} className="relative group aspect-square rounded-lg overflow-hidden bg-muted">
              {p.thumb_path && (
                <img src={publicPhotoUrl(p.thumb_path)} alt="" loading="lazy" className="w-full h-full object-cover" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent opacity-0 group-hover:opacity-100 transition flex flex-col justify-between p-2">
                <div className="flex items-center gap-1 text-xs text-white/90 self-end bg-black/40 rounded px-2 py-1">
                  <Heart className="h-3 w-3" /> {p.face_count}
                </div>
                <Button size="icon" variant="destructive" className="self-end h-8 w-8" onClick={() => deletePhoto(p.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label className="text-sm">{label}</Label>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}