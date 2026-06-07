import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";
import {
  detectFacesInImage,
  loadImageFromBlob,
  loadFaceModels,
  resizeImage,
  computeImageQuality,
} from "@/lib/face";

type Props = {
  eventId: string;
  onUploaded: () => void;
};

export function PhotoUploader({ eventId, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: files.length });
    toast.info("Loading face models…");
    await loadFaceModels();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        // Generate previews
        const originalBlob = await resizeImage(file, 2000, 0.85);
        const previewBlob = await resizeImage(file, 1200, 0.8);
        const thumbBlob = await resizeImage(file, 400, 0.7);
        const quality = await computeImageQuality(previewBlob);

        const ts = Date.now();
        const base = `${eventId}/${ts}-${i}`;
        const originalPath = `${base}/original.jpg`;
        const previewPath = `${base}/preview.jpg`;
        const thumbPath = `${base}/thumb.jpg`;

        await Promise.all([
          supabase.storage.from("photos").upload(originalPath, originalBlob, {
            contentType: "image/jpeg",
            cacheControl: "31536000",
          }),
          supabase.storage.from("photos").upload(previewPath, previewBlob, {
            contentType: "image/jpeg",
            cacheControl: "31536000",
          }),
          supabase.storage.from("photos").upload(thumbPath, thumbBlob, {
            contentType: "image/jpeg",
            cacheControl: "31536000",
          }),
        ]);

        // Detect faces on preview-sized image
        const img = await loadImageFromBlob(previewBlob);
        const faces = await detectFacesInImage(img);

        const { data: photo, error: insErr } = await supabase
          .from("photos")
          .insert({
            event_id: eventId,
            storage_path: originalPath,
            preview_path: previewPath,
            thumb_path: thumbPath,
            status: "published",
            face_count: faces.length,
            quality_score: quality.score,
          })
          .select("id")
          .single();

        if (insErr || !photo) throw insErr;

        if (faces.length > 0) {
          await supabase.from("photo_faces").insert(
            faces.map((f) => ({
              photo_id: photo.id,
              event_id: eventId,
              embedding: f.embedding,
              box: f.box,
            })),
          );
        }

        setProgress({ done: i + 1, total: files.length });
      } catch (err: unknown) {
        console.error(err);
        toast.error(`Failed: ${file.name}`);
      }
    }

    setBusy(false);
    setProgress(null);
    onUploaded();
    toast.success("Uploads complete");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button onClick={() => fileRef.current?.click()} disabled={busy} size="lg">
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Uploading {progress?.done}/{progress?.total}…
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-2" />
            Upload photos
          </>
        )}
      </Button>
      <p className="text-xs text-muted-foreground mt-2">
        Photos are face-indexed in your browser before upload.
      </p>
    </div>
  );
}