import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Camera, Loader2, Sparkles, RefreshCw, AlertCircle, Lightbulb } from "lucide-react";
import {
  detectSingleFace,
  euclideanDistance,
  distanceToConfidence,
  loadFaceModels,
  loadImageFromBlob,
  resizeImage,
} from "@/lib/face";

type EventRow = { id: string; name: string; description: string | null; slug: string };

export const Route = createFileRoute("/e/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — PhotoFlow` },
      { name: "description", content: "Find your photos from this event." },
    ],
  }),
  component: GuestLanding,
});

function GuestLanding() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>("");
  const [error, setError] = useState<"no_face" | "no_photos" | null>(null);

  useEffect(() => {
    supabase
      .from("events")
      .select("id,name,description,slug")
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle()
      .then(({ data }) => setEvent(data));
  }, [slug]);

  async function handleSelfie(file: File) {
    if (!event) return;
    setBusy(true);
    setError(null);
    try {
      setStep("Loading face engine…");
      await loadFaceModels();

      setStep("Detecting your face…");
      // Larger working size so faces in wider/group selfies stay big enough
      // for TinyFaceDetector to find them reliably.
      const resized = await resizeImage(file, 1280, 0.92);
      const img = await loadImageFromBlob(resized);
      const face = await detectSingleFace(img);
      if (!face) {
        setError("no_face");
        setBusy(false);
        return;
      }

      setStep("Searching the gallery…");
      const { data: faces, error } = await supabase
        .from("photo_faces")
        .select("photo_id, embedding")
        .eq("event_id", event.id);
      if (error) throw error;

      // best distance per photo
      const best = new Map<string, number>();
      for (const f of faces ?? []) {
        const d = euclideanDistance(face.embedding, f.embedding as number[]);
        const cur = best.get(f.photo_id);
        if (cur === undefined || d < cur) best.set(f.photo_id, d);
      }

      const matches = Array.from(best.entries())
        .filter(([, d]) => d < 0.65)
        .map(([photo_id, d]) => ({ photo_id, confidence: distanceToConfidence(d) }));

      setStep("Building your gallery…");
      const token = crypto.randomUUID().replace(/-/g, "");
      const { data: session, error: sErr } = await supabase
        .from("guest_sessions")
        .insert({ event_id: event.id, token })
        .select("id, token")
        .single();
      if (sErr || !session) throw sErr;

      if (matches.length > 0) {
        await supabase.from("guest_matches").insert(
          matches.map((m) => ({
            session_id: session.id,
            photo_id: m.photo_id,
            confidence: m.confidence,
          })),
        );
      }

      navigate({ to: "/e/$slug/gallery/$token", params: { slug, token: session.token } });
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading event…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: "var(--gradient-hero)" }}>
      <div className="w-full max-w-md text-center">
        <Sparkles className="h-8 w-8 text-primary mx-auto mb-4" />
        <h1 className="text-3xl font-semibold tracking-tight">{event.name}</h1>
        {event.description && <p className="text-muted-foreground mt-2">{event.description}</p>}
        <div className="mt-10 rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-elegant)]">
          {error === "no_face" ? (
            <div className="text-left">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="h-6 w-6 text-destructive" />
                <h2 className="font-semibold text-xl">No face detected</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                We couldn't find a clear face in your photo. This usually happens when:
              </p>
              <ul className="text-sm space-y-2 mb-6">
                <li className="flex gap-2">
                  <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>The photo is too dark, blurry, or backlit</span>
                </li>
                <li className="flex gap-2">
                  <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Your face is too small, turned sideways, or covered</span>
                </li>
                <li className="flex gap-2">
                  <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Multiple faces are competing for focus</span>
                </li>
              </ul>
              <Button size="lg" className="w-full" onClick={() => { setError(null); fileRef.current?.click(); }}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Try another photo
              </Button>
            </div>
          ) : (
            <>
              <Camera className="h-10 w-10 text-primary mx-auto mb-4" />
              <h2 className="font-semibold text-xl">Find your photos</h2>
              <p className="text-sm text-muted-foreground mt-2 mb-6">
                Take or upload a selfie. We'll match it to photos containing you. Your selfie is processed on your device and never stored.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleSelfie(e.target.files[0])}
              />
              <Button size="lg" className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {step || "Working…"}
                  </>
                ) : (
                  "Upload selfie"
                )}
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-6">Powered by PhotoFlow</p>
      </div>
    </div>
  );
}