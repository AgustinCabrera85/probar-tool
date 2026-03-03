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

const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

export async function createHandTracker(): Promise<HandLandmarker> {
  // WASM desde CDN
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

  // Hand landmarker con umbrales más “sensibles” (mejor en desktop / poca luz)
  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: HAND_MODEL_URL,
    },
    runningMode: "VIDEO",
    numHands: 2,

    // ✅ Bajamos umbrales para que detecte más fácil
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