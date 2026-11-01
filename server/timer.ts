/**
 * Картинка обратного отсчёта: 6 красных «электронных» цифр ЧЧ:ММ:СС.
 * Цифры рисуются сегментами (без шрифтов) — на Vercel нет системных шрифтов.
 */

// Сегменты a b c d e f g
const SEG: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
};

/** Один сегментный символ в прямоугольнике w×h с левым верхним углом (x, y). */
function digit(ch: string, x: number, y: number, w: number, h: number) {
  const t = w * 0.17;           // толщина сегмента
  const g = t * 0.18;           // зазор
  const mid = y + h / 2;
  const hz = (yy: number) => `M${x + t / 2 + g},${yy} l${t / 2},${-t / 2} h${w - 2 * t - 2 * g} l${t / 2},${t / 2} l${-t / 2},${t / 2} h${-(w - 2 * t - 2 * g)} z`;
  const vt = (xx: number, y1: number, y2: number) => `M${xx},${y1 + g} l${t / 2},${t / 2} v${y2 - y1 - t - 2 * g} l${-t / 2},${t / 2} l${-t / 2},${-t / 2} v${-(y2 - y1 - t - 2 * g)} z`;
  const paths: Record<string, string> = {
    a: hz(y + t / 2), g: hz(mid), d: hz(y + h - t / 2),
    f: vt(x + t / 2, y + t / 2, mid), b: vt(x + w - t / 2, y + t / 2, mid),
    e: vt(x + t / 2, mid, y + h - t / 2), c: vt(x + w - t / 2, mid, y + h - t / 2),
  };
  const on = SEG[ch] ?? '';
  return Object.entries(paths)
    .map(([k, p]) => `<path d="${p}" fill="${on.includes(k) ? '#FF2A2A' : '#3A0A12'}"${on.includes(k) ? ' filter="url(#glow)"' : ''}/>`)
    .join('');
}

export function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.min(99, Math.floor(s / 3600))).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return {hh, mm, ss};
}

/** «4 ч 12 мин» */
export function remainStr(ms: number) {
  const m = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h} ч ${m % 60} мин` : `${m} мин`;
}

export function timerSvg(ms: number) {
  const {hh, mm, ss} = parts(ms);
  const W = 1280, H = 520;
  const bw = 160, bh = 250, gap = 18, colon = 70;     // окошко цифры, зазор, место под двоеточие
  const total = 6 * bw + 5 * gap + 2 * colon;
  let x = (W - total) / 2;
  const y = (H - bh) / 2;
  let body = '';
  const groups = [hh, mm, ss];
  groups.forEach((grp, gi) => {
    [...grp].forEach((ch, i) => {
      body += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="22" fill="#12040A" stroke="#5A0F1C" stroke-width="4"/>`;
      body += digit(ch, x + 26, y + 26, bw - 52, bh - 52);
      x += bw + (i === 0 ? gap : 0);
    });
    if (gi < 2) {
      const cx = x + colon / 2 - gap / 2;
      body += `<circle cx="${cx}" cy="${y + bh * 0.33}" r="13" fill="#FF2A2A" filter="url(#glow)"/>`;
      body += `<circle cx="${cx}" cy="${y + bh * 0.67}" r="13" fill="#FF2A2A" filter="url(#glow)"/>`;
      x += colon + gap;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <radialGradient id="bg" cx="50%" cy="50%" r="75%"><stop offset="0" stop-color="#2A0E44"/><stop offset="1" stop-color="#12061F"/></radialGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="34" fill="none" stroke="#FF8A1E" stroke-opacity=".55" stroke-width="4"/>
${body}
</svg>`;
}

/** PNG таймера. sharp грузим лениво, чтобы сбой картинки не ронял бот. */
export async function timerPng(ms: number): Promise<Uint8Array> {
  const {default: sharp} = await import('sharp');
  return new Uint8Array(await sharp(Buffer.from(timerSvg(ms))).png().toBuffer());
}
