export const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "--");

export function duration(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function leanText(lean: number) {
  const a = Math.abs(lean);
  if (a < 1) return { side: "", value: "0" };
  return { side: lean < 0 ? "L" : "R", value: a.toFixed(0) };
}
