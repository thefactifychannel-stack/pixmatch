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
  const opts = new faceapi.TinyFaceDetectorOptions({
    inputSize: 416,
    scoreThreshold: 0.5,
  });
  const result = await faceapi
    .detectSingleFace(imgEl, opts)
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  if (!result) return null;
  return {
    embedding: Array.from(result.descriptor),
    box: {
      x: result.detection.box.x,
      y: result.detection.box.y,
      width: result.detection.box.width,
      height: result.detection.box.height,
    },
  };
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// face-api uses descriptors where distance < 0.6 is a typical match threshold.
// Returns confidence in [0, 1], where 1 = perfect match.
export function distanceToConfidence(dist: number): number {
  return Math.max(0, Math.min(1, 1 - dist / 1.0));
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
  const bmp = await createImageBitmap(file);
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