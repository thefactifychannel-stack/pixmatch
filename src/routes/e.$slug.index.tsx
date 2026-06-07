import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Camera, Loader2, Sparkles, RefreshCw, AlertCircle, Lightbulb } from "lucide-react";
import {
  detectFacesInImage,
  loadFaceModels,
  loadImageFromBlob,
  resizeImage,
} from "@/lib/face";
import { matchGuestSelfie } from "@/lib/guest.functions";

type EventRow = { id: string; name: string; description: string | null; slug: string };

type Stage =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number; label: string }
  | { kind: "done"; matchCount: number; people: number; scanned: number; token: string };

export const Route = createFileRoute("/e/$slug/")({
  component: GuestLanding,
});

function GuestLanding() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState<"no_face" | null>(null);

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
    setError(null);
    try {
      setStage({ kind: "uploading", pct: 10, label: "Uploading photo…" });
      await loadFaceModels();

      setStage({ kind: "uploading", pct: 35, label: "Detecting faces…" });
      const resized = await resizeImage(file, 1280, 0.92);
      const img = await loadImageFromBlob(resized);
      const faces = await detectFacesInImage(img);
      if (!faces || faces.length === 0) {
        setError("no_face");
        setStage({ kind: "idle" });
        return;
      }

      setStage({ kind: "uploading", pct: 65, label: `Searching photos (${faces.length} ${faces.length === 1 ? "person" : "people"})…` });
      const res = await matchGuestSelfie({
        data: { slug, embeddings: faces.map((f) => Array.from(f.embedding)) },
      });

      setStage({ kind: "uploading", pct: 90, label: "Organizing results…" });
      await new Promise((r) => setTimeout(r, 250));
      setStage({
        kind: "done",
        matchCount: res.matchCount,
        people: res.peopleDetected,
        scanned: res.totalScanned,
        token: res.token,
      });
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setStage({ kind: "idle" });
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
          ) : stage.kind === "done" ? (
            <div className="text-left">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-6 w-6 text-primary" />
                <h2 className="font-semibold text-xl">Search complete</h2>
              </div>
              <div className="rounded-xl bg-secondary/60 p-4 text-sm space-y-1 mb-6">
                <div className="flex justify-between"><span className="text-muted-foreground">People detected</span><span className="font-medium">{stage.people}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Photos scanned</span><span className="font-medium">{stage.scanned.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Matching photos</span><span className="font-medium text-primary">{stage.matchCount}</span></div>
              </div>
              <Button
                size="lg"
                className="w-full"
                onClick={() =>
                  navigate({ to: "/e/$slug/gallery/$token", params: { slug, token: stage.token } })
                }
              >
                View gallery →
              </Button>
              <button
                className="w-full text-xs text-muted-foreground hover:text-foreground mt-3"
                onClick={() => { setStage({ kind: "idle" }); fileRef.current?.click(); }}
              >
                Search with a different selfie
              </button>
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
              {stage.kind === "uploading" ? (
                <div className="w-full">
                  <div className="relative w-full h-12 rounded-md bg-secondary overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-primary transition-all duration-300"
                      style={{ width: `${stage.pct}%` }}
                    />
                    <div className="relative z-10 h-full flex items-center justify-center text-sm font-medium">
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {stage.label} {stage.pct}%
                    </div>
                  </div>
                </div>
              ) : (
                <Button size="lg" className="w-full" onClick={() => fileRef.current?.click()}>
                  Upload selfie
                </Button>
              )}
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-6">Powered by PhotoFlow</p>
      </div>
    </div>
  );
}