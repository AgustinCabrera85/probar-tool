import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

export type HandPoint = { x: number; y: number; z?: number };

export type HandResult = {
  // 21 landmarks (x,y normalizados 0..1)
  landmarks: HandPoint[];
  handedness?: "Left" | "Right";
};

export type TrackerState = {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
};

// ✅ PRODUCCIÓN (Vercel): serví WASM + modelo desde /public para no depender de CDNs
// Asegurate de tener:
// - public/mediapipe/wasm/*
// - public/mediapipe/models/hand_landmarker.task
const WASM_BASE_URL = "/mediapipe/wasm";
const HAND_MODEL_URL = "/mediapipe/models/hand_landmarker.task";

export async function createHandTracker(): Promise<HandLandmarker> {
  // ✅ WASM desde tu mismo dominio (Vercel)
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      // ✅ Modelo desde tu mismo dominio (Vercel)
      modelAssetPath: HAND_MODEL_URL,
    },
    runningMode: "VIDEO",
    numHands: 2,

    // ✅ Umbrales bajos para que detecte más fácil (desktop / mala luz)
    minHandDetectionConfidence: 0.15,
    minHandPresenceConfidence: 0.15,
    minTrackingConfidence: 0.15,
  });

  return handLandmarker;
}

export function detectHands(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  nowMs: number
): HandResult | null {
  const res = landmarker.detectForVideo(video, nowMs);
  if (!res?.landmarks?.length) return null;

  const lm = res.landmarks[0] as HandPoint[];

  let handed: "Left" | "Right" | undefined;
  const cat = res.handedness?.[0]?.[0];
  if (cat?.categoryName === "Left" || cat?.categoryName === "Right") {
    handed = cat.categoryName;
  }

  return { landmarks: lm, handedness: handed };
}