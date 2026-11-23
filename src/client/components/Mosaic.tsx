// The 2023 site's background (legacy/inquisitor-web/src/components/Background):
// a fixed grid of 30px squares in random dark reds and browns, drawn once
// per screen size on a 2D canvas behind every page.
import { useEffect, useRef } from "preact/hooks";

const CELL = 30; // CSS pixels per square

// The old randomDark(): hue 0–30°, saturation 0.7–0.9, value 0–0.2.
function darkRed(): string {
  const h = Math.random() * 30;
  const s = Math.random() * 0.2 + 0.7;
  const v = Math.random() * 0.2;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `rgb(${f(5)} ${f(3)} ${f(1)})`;
}

export function Mosaic() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // Colours are kept per square, so a resize only adds squares.
    const colours: string[][] = [];
    let w = 0;
    let h = 0;
    const draw = () => {
      const nw = window.innerWidth;
      const nh = window.innerHeight;
      if (nw <= w && nh <= h) return;
      w = Math.max(w, nw);
      h = Math.max(h, nh);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let x = 0; x * CELL < w; x++) {
        const col = (colours[x] ??= []);
        for (let y = 0; y * CELL < h; y++) {
          ctx.fillStyle = col[y] ??= darkRed();
          ctx.fillRect(x * CELL, y * CELL, CELL + 0.5, CELL + 0.5);
        }
      }
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);
  return <canvas ref={ref} class="mosaic" aria-hidden="true" />;
}
