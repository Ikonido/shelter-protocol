import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** Матрица QR-кода (true = тёмный модуль). Отдельно от React — чтобы проверять независимым декодером. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** QR как SVG из <path> (без innerHTML). Всегда чёрное на белом с «тихой зоной»: инвертированные коды сканируются хуже. */
export function QR({ value, size = 224, label }: { value: string; size?: number; label?: string }) {
  const { n, d } = useMemo(() => {
    const m = qrMatrix(value);
    const parts: string[] = [];
    m.forEach((row, r) => {
      let c = 0;
      while (c < row.length) {
        if (!row[c]) { c++; continue; }
        let len = 1;
        while (row[c + len]) len++;
        parts.push(`M${c + 4} ${r + 4}h${len}v1h-${len}z`);
        c += len;
      }
    });
    return { n: m.length, d: parts.join('') };
  }, [value]);
  const box = n + 8; // 4 модуля тихой зоны с каждой стороны
  return (
    <svg role="img" aria-label={label ?? 'QR-код'} width={size} height={size} viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" className="mx-auto rounded bg-white">
      <rect width={box} height={box} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
