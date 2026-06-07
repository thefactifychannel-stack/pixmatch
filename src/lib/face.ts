// Client-side face recognition using face-api.js.
// Loads tiny models from CDN; computes 128-d face descriptors.
import * as faceapi from "face-api.js";

const MODEL_URL =
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";

let loadingPromise: Promise<void> | null = null;

export async function loadFaceModels(): Promise<void> {
  if (typeof window === "undefined") return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
  })();
  return loadingPromise;
}

export type DetectedFace = {
  embedding: number[];
  box: { x: number; y: number; width: number; height: number };
};

export async function detectFacesInImage(
  imgEl: HTMLImageElement,
): Promise<DetectedFace[]> {
  await loadFaceModels();
  const opts = new faceapi.TinyFaceDetectorOptions({
    inputSize: 416,
    scoreThreshold: 0.5,
  });
  const results = await faceapi
    .detectAllFaces(imgEl, opts)
    .withFaceLandmarks(true)
    .withFaceDescriptors();
  return results.map((r) => ({
    embedding: Array.from(r.descriptor),
    box: {
      x: r.detection.box.x,
      y: r.detection.box.y,
      width: r.detection.box.width,
      height: r.detection.box.height,
    },
  }));
}

export async function detectSingleFace(
  imgEl: HTMLImageElement,
): Promise<DetectedFace | null> {
  await loadFaceModels();
  // Try progressively larger input sizes and lower thresholds so we don't
  // miss small / off-center faces in a guest's selfie.
  const attempts: Array<{ inputSize: number; scoreThreshold: number }> = [
    { inputSize: 608, scoreThreshold: 0.4 },
    { inputSize: 512, scoreThreshold: 0.3 },
    { inputSize: 416, scoreThreshold: 0.3 },
  ];
  for (const a of attempts) {
    const opts = new faceapi.TinyFaceDetectorOptions(a);
    // Detect all faces, then pick the largest — handles selfies where the
    // intended face is biggest but not most centered.
    const results = await faceapi
      .detectAllFaces(imgEl, opts)
      .withFaceLandmarks(true)
      .withFaceDescriptors();
    if (results.length > 0) {
      const best = results.reduce((a, b) =>
        a.detection.box.area > b.detection.box.area ? a : b,
      );
      return {
        embedding: Array.from(best.descriptor),
        box: {
          x: best.detection.box.x,
          y: best.detection.box.y,
          width: best.detection.box.width,
          height: best.detection.box.height,
        },
      };
    }
  }
  return null;
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// face-api descriptors: distance < 0.6 is a confident match, < 0.4 is very strong.
// Rescale so dist=0.3 → 1.0, dist=0.45 → ~0.6, dist=0.6 → 0.
export function distanceToConfidence(dist: number): number {
  return Math.max(0, Math.min(1, (0.6 - dist) / 0.3));
}

export async function loadImageFromBlob(
  blob: Blob,
): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // caller can revoke later; we keep until image is used
  }
}

export async function loadImageFromUrl(
  url: string,
): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  return img;
}

// Resize an image file to a max dimension and return a JPEG blob.
export async function resizeImage(
  file: File | Blob,
  maxDim: number,
  quality = 0.85,
): Promise<Blob> {
  // Respect EXIF orientation so a portrait phone/DSLR photo isn't fed
  // sideways to the face detector.
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bmp = await createImageBitmap(file);
  }
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  return await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/jpeg", quality),
  );
}

// Compute a 0..1 quality score from an image blob using:
//   - brightness: mean luma (0..255)
//   - sharpness:  variance of a 3x3 Laplacian on grayscale
// Returns combined score plus the underlying metrics so callers can decide
// "low light" vs "best" buckets.
export async function computeImageQuality(
  blob: Blob,
): Promise<{ score: number; brightness: number; sharpness: number; lowLight: boolean }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    bmp = await createImageBitmap(blob);
  }
  const maxDim = 256;
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  // Grayscale + brightness
  const gray = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = y;
    sum += y;
  }
  const brightness = sum / (w * h); // 0..255

  // Laplacian variance (sharpness proxy)
  let lapSum = 0;
  let lapSumSq = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        -gray[i - w] - gray[i - 1] + 4 * gray[i] - gray[i + 1] - gray[i + w];
      lapSum += v;
      lapSumSq += v * v;
      count++;
    }
  }
  const mean = lapSum / count;
  const variance = lapSumSq / count - mean * mean;
  // Normalize: typical sharp photo ~ 300+, blurry < 60
  const sharpness = variance;

  // Brightness scoring: ideal ~110-170, drops off outside that
  const brightnessScore =
    brightness < 60
      ? Math.max(0, brightness / 60) * 0.5
      : brightness > 220
        ? Math.max(0, (255 - brightness) / 35) * 0.7
        : 1;
  const sharpnessScore = Math.max(0, Math.min(1, (sharpness - 40) / 260));
  const score = Math.max(0, Math.min(1, 0.55 * sharpnessScore + 0.45 * brightnessScore));
  const lowLight = brightness < 70 || sharpnessScore < 0.2;
  return { score, brightness, sharpness, lowLight };
}