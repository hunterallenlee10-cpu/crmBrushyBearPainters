"use client";

import * as React from "react";
import { Eraser } from "lucide-react";

/**
 * A finger/mouse signature box. Reports a PNG data URL after each stroke
 * (null when cleared). Pointer events cover touch, pen and mouse.
 */
export function SignaturePad({
  onChange,
  disabled,
  labelId,
}: {
  onChange: (png: string | null) => void;
  disabled?: boolean;
  labelId: string;
}) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const last = React.useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = React.useState(true);

  // Size the canvas to its box (sharp on high-DPI screens).
  React.useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const fit = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#2b2b2b";
      setEmpty(true);
      onChange(null);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [onChange]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = e.currentTarget.getContext("2d");
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = "#2b2b2b";
      ctx.fill();
    }
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const ctx = e.currentTarget.getContext("2d");
    const p = point(e);
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    setEmpty(false);
    const c = canvas.current;
    if (c) onChange(c.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <canvas
          ref={canvas}
          role="img"
          aria-labelledby={labelId}
          data-testid="signature-pad"
          className="h-40 w-full touch-none rounded-xl border-2 border-dashed border-bb-forest/40 bg-white"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
        {empty && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            Sign here with your finger or mouse
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        disabled={disabled || empty}
        className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-sm text-bb-forest hover:underline disabled:opacity-50"
      >
        <Eraser className="size-4" aria-hidden />
        Clear signature
      </button>
    </div>
  );
}
