import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

export type HandPoint = { x: number; y: number; z?: number };
export type HandResult = { landmarks: HandPoint[]; handedness?: "Left" | "Right" };

const WASM_BASE_URL = "/mediapipe/wasm";
const HAND_MODEL_URL = "/mediapipe/models/hand_landmarker.task";

export async function createHandTracker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

  return await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_MODEL_URL },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.15,
    minHandPresenceConfidence: 0.15,
    minTrackingConfidence: 0.15,
  });
}

export function detectHands(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  nowMs: number
): HandResult | null {
  const res = landmarker.detectForVideo(video, nowMs);
  if (!res?.landmarks?.length) return null;

  const lm = res.landmarks[0] as HandPoint[];
  const cat = res.handedness?.[0]?.[0];
  const handedness =
    cat?.categoryName === "Left" || cat?.categoryName === "Right"
      ? (cat.categoryName as "Left" | "Right")
      : undefined;

  return { landmarks: lm, handedness };
}