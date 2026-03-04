import { useEffect, useMemo, useRef, useState } from "react";
import { createHandTracker, detectHands } from "../ar/handTracker";
import { drawNails2D } from "../ar/nailRenderer2d";
import type { V2 } from "../ar/geometry";
import { clamp, smooth } from "../ar/geometry";

type Design = { id: string; name: string; thumb: string; image: string };
type Catalog = { designs: Design[] };

type TabKey = "designs" | "length" | "settings";

const FINGER_TIPS = [
  { tip: 4, dip: 3 }, // thumb
  { tip: 8, dip: 7 }, // index
  { tip: 12, dip: 11 }, // middle
  { tip: 16, dip: 15 }, // ring
  { tip: 20, dip: 19 }, // pinky
] as const;

function useImage(url: string | null) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!url) return;
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.onerror = () => setImg(null);
    i.src = url;
  }, [url]);

  return img;
}

export default function TryOnPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selectedDesignId, setSelectedDesignId] = useState<string | null>(null);
  const selectedDesign = useMemo(
    () =>
      catalog?.designs?.find((d) => d.id === selectedDesignId) ??
      catalog?.designs?.[0] ??
      null,
    [catalog, selectedDesignId]
  );

  const nailImg = useImage(selectedDesign?.image ?? null);

  const [tab, setTab] = useState<TabKey>("designs");
  const [length01, setLength01] = useState(0.35);
  const [isFreeze, setIsFreeze] = useState(false);

  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const [handDetected, setHandDetected] = useState(false);

  // Freeze frame buffer
  const freezeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // tracker
  const landmarkerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);

  // ✅ Loop gate (no stale closure)
  const readyRef = useRef(false);

  // smoothing
  const smRef = useRef<Record<string, number | null>>({});

  // ✅ Monotonic timestamp for MediaPipe (fixes "Packet timestamp mismatch")
  const tsRef = useRef(0);
  const lastPerfRef = useRef(0);

  // ✅ Lost-hand counter to soft-reset timestamps after a while
  const lostRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/catalog/designs.json");
        const data = (await res.json()) as Catalog;
        setCatalog(data);
        setSelectedDesignId(data.designs?.[0]?.id ?? null);
      } catch {
        setCatalog({ designs: [] });
      }
    })();
  }, []);

  async function startCamera() {
    if (!videoRef.current) return;
    setStatus("loading");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          // En mobile podés forzar trasera si querés:
          // facingMode: "environment",
        },
        audio: false,
      });

      videoRef.current.srcObject = stream;

      await videoRef.current.play();

      // ✅ wait until video has real dimensions
      await new Promise<void>((resolve) => {
        const v = videoRef.current!;
        if (v.readyState >= 2 && v.videoWidth > 0) return resolve();
        v.addEventListener("loadeddata", () => resolve(), { once: true });
      });

      // tracker
      landmarkerRef.current = await createHandTracker();

      // freeze buffer
      if (!freezeCanvasRef.current) {
        freezeCanvasRef.current = document.createElement("canvas");
      }

      // reset loop + timestamps
      stopLoop();
      readyRef.current = true;
      tsRef.current = 0;
      lastPerfRef.current = 0;
      lostRef.current = 0;

      setStatus("ready");
      loop();
    } catch (e: any) {
      console.error(e);
      readyRef.current = false;
      setStatus("error");
    }
  }

  function stopLoop() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  function cleanupCamera() {
    const v = videoRef.current;
    if (!v) return;
    const s = v.srcObject as MediaStream | null;
    if (s) s.getTracks().forEach((t) => t.stop());
    v.srcObject = null;
  }

  useEffect(() => {
    return () => {
      readyRef.current = false;
      stopLoop();
      cleanupCamera();
    };
  }, []);

  function ensureCanvasSize() {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;

    const vw = v.videoWidth || 1280;
    const vh = v.videoHeight || 720;

    if (c.width !== vw || c.height !== vh) {
      c.width = vw;
      c.height = vh;
    }
  }

  function drawFrameToCanvas(ctx: CanvasRenderingContext2D) {
    const v = videoRef.current;
    if (!v) return;
    ctx.drawImage(v, 0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  function captureFreezeFrame() {
    const v = videoRef.current;
    const fc = freezeCanvasRef.current;
    if (!v || !fc) return;

    const vw = v.videoWidth || 1280;
    const vh = v.videoHeight || 720;

    fc.width = vw;
    fc.height = vh;

    const fctx = fc.getContext("2d");
    if (!fctx) return;

    fctx.drawImage(v, 0, 0, vw, vh);
  }

  function nextMonotonicTimestampMs() {
    const p = performance.now();
    if (lastPerfRef.current === 0) lastPerfRef.current = p;

    const delta = p - lastPerfRef.current;
    lastPerfRef.current = p;

    // clamp delta to avoid huge jumps (tab switch / lag)
    tsRef.current += Math.min(Math.max(delta, 0), 33);

    return tsRef.current;
  }

  function softResetTracking() {
  smRef.current = {};
  lostRef.current = 0;
  tsRef.current = 0;
  lastPerfRef.current = 0;
}

  function loop() {
    rafRef.current = requestAnimationFrame(loop);

    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;

    if (!readyRef.current) return;
    if (v.readyState < 2 || v.videoWidth === 0) return;

    ensureCanvasSize();
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, c.width, c.height);

    if (isFreeze && freezeCanvasRef.current) {
      ctx.drawImage(freezeCanvasRef.current, 0, 0, c.width, c.height);
    } else {
      drawFrameToCanvas(ctx);
    }

    const landmarker = landmarkerRef.current;
    if (!landmarker) return;

    // ✅ monotonic timestamp fixes MediaPipe graph errors
    const nowMs = nextMonotonicTimestampMs();

    let res: ReturnType<typeof detectHands> | null = null;

    try {
      res = detectHands(landmarker, v, nowMs);
    } catch (e) {
      // If MediaPipe throws (rare), reset timestamps and keep running
      tsRef.current = 0;
      lastPerfRef.current = 0;
      res = null;
    }

    if (!res) {
      lostRef.current += 1;
      if (handDetected !== false) setHandDetected(false);

      // ✅ After ~1s without hand, soft-reset timestamps
      if (lostRef.current > 30) {
        tsRef.current = 0;
        lastPerfRef.current = 0;
        lostRef.current = 0;
      }

      drawGuide(ctx);
      drawHud(ctx, false, isFreeze);
      return;
    }

    lostRef.current = 0;
    if (handDetected !== true) setHandDetected(true);

    const ptsPx: V2[] = res.landmarks.map((p, idx) => {
      const keyX = `x${idx}`;
      const keyY = `y${idx}`;
      const prevX = smRef.current[keyX] ?? null;
      const prevY = smRef.current[keyY] ?? null;

      const sx = smooth(prevX, p.x, 0.35);
      const sy = smooth(prevY, p.y, 0.35);

      smRef.current[keyX] = sx;
      smRef.current[keyY] = sy;

      return { x: sx * c.width, y: sy * c.height };
    });

    const fingers = FINGER_TIPS.map((f) => ({
      tip: ptsPx[f.tip],
      dip: ptsPx[f.dip],
    }));

    if (nailImg) {
      drawNails2D(ctx, nailImg, fingers, {
      length01: clamp(length01, 0, 1),
      baseWidthPx: 44,
      baseLengthPx: 84,
      insetPx: 12,
      tipOutsetPx: 1,
      lateralOffsetPx: 0,
});
    }

    drawHud(ctx, true, isFreeze);
  }

  function drawGuide(ctx: CanvasRenderingContext2D) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const pad = Math.min(w, h) * 0.12;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, 28);
    ctx.stroke();

    ctx.font = "28px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("Colocá tu mano dentro del recuadro", pad, pad - 18);

    ctx.restore();
  }

  function drawHud(ctx: CanvasRenderingContext2D, detected: boolean, freeze: boolean) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, 20, 20, 420, 74, 18);
    ctx.fill();

    ctx.font = "22px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(detected ? "Mano detectada ✓" : "Buscando mano…", 40, 52);

    ctx.font = "18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(freeze ? "Freeze: ON" : "Freeze: OFF", 40, 78);

    ctx.beginPath();
    ctx.arc(380, 53, 10, 0, Math.PI * 2);
    ctx.fillStyle = detected ? "rgba(60,220,120,0.95)" : "rgba(255,80,80,0.95)";
    ctx.fill();

    ctx.restore();
  }

  function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function onToggleFreeze() {
    setIsFreeze((prev) => {
      const next = !prev;
      if (next) {
        captureFreezeFrame();
        // reset monotonic clock to avoid rare jumps
        tsRef.current = 0;
        lastPerfRef.current = 0;
        lostRef.current = 0;
      }
      return next;
    });
  }

  function onCapture() {
    const c = canvasRef.current;
    if (!c) return;

    const url = c.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `probar-tool_${Date.now()}.png`;
    a.click();
  }

  return (
    <div className="h-full w-full bg-zinc-950 text-white">
      {/* TOP BAR */}
      <div className="fixed top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/70 to-transparent">
        <div className="text-sm font-semibold tracking-wide">probAR • probar-tool</div>
        <div className="text-xs text-white/70">
          {status === "ready" ? "Listo" : status === "loading" ? "Cargando…" : ""}
        </div>
      </div>

      {/* CAMERA + CANVAS */}
      <div className="relative h-full w-full overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />

        {/* CTA inicial */}
        {status !== "ready" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
            <div className="w-[92%] max-w-md rounded-2xl border border-white/10 bg-zinc-900/60 p-5 backdrop-blur">
              <div className="text-lg font-semibold">Probador AR de uñas</div>
              <div className="mt-2 text-sm text-white/75">
                Apuntá a tu mano, ajustá el largo y sacá una captura.
              </div>

              <div className="mt-4 flex gap-3">
                <button
                  onClick={startCamera}
                  className="flex-1 rounded-xl bg-white px-4 py-3 text-zinc-950 font-semibold hover:bg-white/90"
                >
                  Iniciar cámara
                </button>
              </div>

              {status === "error" && (
                <div className="mt-3 text-sm text-red-300">
                  No se pudo acceder a la cámara o cargar el modelo. Probá con permisos habilitados.
                </div>
              )}

              <div className="mt-4 text-xs text-white/60 leading-relaxed">
                Tip: buena luz y mano dentro del recuadro mejora el resultado.
              </div>
            </div>
          </div>
        )}

        {/* ACTION BUTTONS */}
        {status === "ready" && (
          <div className="absolute right-4 top-16 z-20 flex flex-col gap-3">
            <button
              onClick={onToggleFreeze}
              className={`rounded-xl px-4 py-3 text-sm font-semibold shadow-lg border border-white/10 ${
                isFreeze ? "bg-emerald-500/90 text-black" : "bg-zinc-900/70 text-white"
              }`}
            >
              {isFreeze ? "Freeze ON" : "Freeze"}
            </button>

            <button
              onClick={onCapture}
              className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-950 shadow-lg hover:bg-white/90"
            >
              Capturar
            </button>
          </div>
        )}

        {/* BOTTOM SHEET */}
        {status === "ready" && (
          <div className="absolute bottom-0 left-0 right-0 z-20">
            <div className="mx-auto w-full max-w-2xl rounded-t-3xl border border-white/10 bg-zinc-950/80 backdrop-blur">
              <div className="flex items-center gap-2 px-4 pt-3">
                <TabButton active={tab === "designs"} onClick={() => setTab("designs")} label="Diseños" />
                <TabButton active={tab === "length"} onClick={() => setTab("length")} label="Largo" />
                <TabButton active={tab === "settings"} onClick={() => setTab("settings")} label="Ajustes" />
                <div className="ml-auto text-xs text-white/60">
                  {handDetected ? "Mano ✓" : "Buscando…"}
                </div>
              </div>

              <div className="px-4 pb-5 pt-3">
                {tab === "designs" && (
                  <div>
                    <div className="text-sm text-white/70 mb-3">
                      Elegí un diseño (se aplica a todos los dedos).
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      {(catalog?.designs ?? []).map((d) => (
                        <button
                          key={d.id}
                          onClick={() => {
                            setSelectedDesignId(d.id);

                            // ✅ soft reset para que no se "pegue" al cambiar diseño
                            smRef.current = {};
                            lostRef.current = 0;
                            tsRef.current = 0;
                            lastPerfRef.current = 0;
                          }}
                          className={`rounded-2xl border p-2 text-left transition ${
                            selectedDesign?.id === d.id
                              ? "border-white/50 bg-white/10"
                              : "border-white/10 bg-white/5 hover:bg-white/10"
                          }`}
                        >
                          <div className="aspect-square w-full overflow-hidden rounded-xl bg-black/20">
                            <img src={d.thumb} alt={d.name} className="h-full w-full object-cover" />
                          </div>
                          <div className="mt-2 text-xs font-semibold">{d.name}</div>
                        </button>
                      ))}
                    </div>

                    {!catalog?.designs?.length && (
                      <div className="text-sm text-red-200">
                        No se pudo cargar el catálogo. Revisá /public/catalog/designs.json
                      </div>
                    )}
                  </div>
                )}

                {tab === "length" && (
                  <div>
                    <div className="text-sm text-white/70">Ajustá el largo (visual, no medido).</div>

                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">Largo</div>
                        <div className="text-xs text-white/60">{labelFromLength(length01)}</div>
                      </div>

                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={length01}
                        onChange={(e) => setLength01(parseFloat(e.target.value))}
                        className="mt-4 w-full"
                      />

                      <div className="mt-2 flex justify-between text-[11px] text-white/55">
                        <span>Corto</span>
                        <span>Medio</span>
                        <span>Largo</span>
                        <span>XL</span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <PresetChip label="Corto" onClick={() => setLength01(0.15)} />
                        <PresetChip label="Natural" onClick={() => setLength01(0.30)} />
                        <PresetChip label="Medio" onClick={() => setLength01(0.45)} />
                        <PresetChip label="Largo" onClick={() => setLength01(0.65)} />
                        <PresetChip label="XL" onClick={() => setLength01(0.85)} />
                      </div>
                    </div>
                  </div>
                )}

                {tab === "settings" && (
                  <div className="space-y-3">
                    <div className="text-sm text-white/70">
                      Consejos: activá <b>Freeze</b> para ajustar con la mano quieta.
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold">Freeze</div>
                          <div className="text-xs text-white/60">Congela la imagen para ajustar sin moverte</div>
                        </div>
                        <button
                          onClick={onToggleFreeze}
                          className={`rounded-xl px-3 py-2 text-xs font-semibold border border-white/10 ${
                            isFreeze ? "bg-emerald-500/90 text-black" : "bg-zinc-900/70 text-white"
                          }`}
                        >
                          {isFreeze ? "ON" : "OFF"}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-sm font-semibold">Notas</div>
                      <ul className="mt-2 list-disc pl-5 text-xs text-white/70 space-y-1">
                        <li>Buena luz mejora tracking.</li>
                        <li>Si el PNG no “calza” perfecto, es normal en MVP.</li>
                        <li>Más adelante podemos sumar ajuste fino por dedo y oclusión.</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="h-3 bg-transparent" />
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={props.onClick}
      className={`rounded-xl px-3 py-2 text-sm font-semibold border transition ${
        props.active
          ? "bg-white/10 border-white/30"
          : "bg-transparent border-white/10 text-white/75 hover:bg-white/5"
      }`}
    >
      {props.label}
    </button>
  );
}

function PresetChip(props: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className="rounded-full border border-white/10 bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-zinc-900"
    >
      {props.label}
    </button>
  );
}

function labelFromLength(v: number) {
  if (v < 0.25) return "Corto";
  if (v < 0.42) return "Natural";
  if (v < 0.58) return "Medio";
  if (v < 0.75) return "Largo";
  return "XL";
}