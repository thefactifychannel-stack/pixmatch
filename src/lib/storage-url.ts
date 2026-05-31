export function publicPhotoUrl(path: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  return `${base}/storage/v1/object/public/photos/${path}`;
}