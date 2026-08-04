// 絵葉書のデザインバリアント。1窓=1デザインで、切替ごとにランダムに変わる
// （フォントと同じく他窓と被らないよう選ぶ）。?design=名前 で全窓固定（確認用）。
// 各デザインは designLayout()（動画・キャプションの矩形とクリップ）と
// renderDecor()（消印・罫線・テープ等の装飾DOM）の2つで定義する。
// 座標系はすべてはがき基準のmm。px化はlayout.jsのpxMm（L.pxMm）で行う。
import { POSTCARD } from './layout.js';

export const DESIGNS = [
  'stamp',        // 切手ミシン目 + 丸消印
  'airmail',      // 赤青ストライプのエアメール
  'fullbleed',    // 全面写真 + 下部の帯キャプション
];

// 切手のミシン目 (mm)
const PERF = { r: 1, step: 3.5 };
// はがき端 → コンテンツのマージン / 動画とキャプションの間 (mm)
const PAD = 3;
const GAP = 3;

const INK_BLUE = 'rgba(43, 74, 139, 0.68)';   // 消印インク

const FORCED = new URLSearchParams(location.search).get('design');

// 自窓の前回デザインだけを避けてランダムに選ぶ（他窓との被りは許容）。
// 切替のたびに必ず別のデザインへ変わる。?design=指定時は常にそれ。
export function pickDesign(current) {
  if (FORCED && DESIGNS.includes(FORCED)) return FORCED;
  const pool = DESIGNS.filter((d) => d !== current);
  return pool[Math.floor(Math.random() * pool.length)] ?? DESIGNS[0];
}

// 切手のミシン目風クリップパス: 矩形の全周に半円ノッチを等間隔で刻む
export function stampPath(w, h, r, step) {
  const f = (v) => v.toFixed(2);
  let d = `M 0 0 `;
  const edge = (len, point, arc) => {
    const n = Math.max(2, Math.round(len / step));
    const s = len / n;
    for (let k = 1; k < n; k++) {
      const c = k * s;
      d += `L ${point(c - r)} A ${f(r)} ${f(r)} 0 0 0 ${point(c + r)} `;
    }
    d += `L ${arc} `;
  };
  edge(w, (c) => `${f(c)} 0`, `${f(w)} 0`);                    // 上（左→右）
  edge(h, (c) => `${f(w)} ${f(c)}`, `${f(w)} ${f(h)}`);        // 右（上→下）
  edge(w, (c) => `${f(w - c)} ${f(h)}`, `0 ${f(h)}`);          // 下（右→左）
  edge(h, (c) => `0 ${f(h - c)}`, `0 0`);                      // 左（下→上）
  return d + 'Z';
}

const rectPx = (p, x, y, w, h) => ({ x: x * p, y: y * p, w: w * p, h: h * p });

// デザインごとの矩形・クリップ。
// 戻り値: { video, caption (px), clip (clip-path文字列|null),
//           videoInner (フルブリード用の内側矩形|null) }
export function designLayout(name, L) {
  const p = L.pxMm;
  const W = POSTCARD.w;
  const H = POSTCARD.h;
  const base = () => {
    const vw = W - 2 * PAD;
    const vh = (vw * 9) / 16;
    const capTop = PAD + vh + GAP;
    return {
      video: rectPx(p, PAD, PAD, vw, vh),
      caption: rectPx(p, PAD, capTop, vw, H - PAD - capTop),
      clip: null,
      videoInner: null,
    };
  };

  switch (name) {
    case 'stamp': {
      const d = base();
      d.clip = stampPath(d.video.w, d.video.h, PERF.r * p, PERF.step * p);
      return d;
    }
    case 'airmail': {
      // 縁の赤青ストライプ分だけコンテンツを内側に寄せ、動画は垂直中央に置く。
      // キャプションはコンテンツ領域全体に広げ、CSS（.design-airmail）が
      // タイトルを上余白の中央揃え・メタを下余白に振り分ける
      const pad = 6.5;
      const vw = W - 2 * pad;
      const vh = (vw * 9) / 16;
      return {
        video: rectPx(p, pad, (H - vh) / 2, vw, vh),
        caption: rectPx(p, pad, pad, vw, H - 2 * pad),
        clip: null,
        videoInner: null,
      };
    }
    case 'fullbleed': {
      // 四辺同じ細い紙マージンを残して動画を大きく敷く（16:9をカバーで中央クロップ）。
      // キャプションは余白の帯に書く: タイトル=左上、時刻=右上、地名=右下。
      // 文字の配置はCSS（.design-fullbleed）が余白帯の高さ（PAD/H %）に合わせて行う
      const pad = 4;
      const vw = W - 2 * pad;
      const vh = H - 2 * pad;
      const coverW = (vh * 16) / 9;
      return {
        video: rectPx(p, pad, pad, vw, vh),
        caption: rectPx(p, pad, 0, vw, H),
        clip: null,
        videoInner: rectPx(p, (vw - coverW) / 2, 0, coverW, vh),
      };
    }
    default:
      return base();
  }
}

// 動画メタ由来のテキスト（YouTube/パイプライン産＝非信頼）をHTMLに埋める前にエスケープする
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 丸消印 + 波線（切手デザイン用）。data からカメラ現地の地名・日付を入れる
function postmarkSvg(p, data, seed) {
  const loc = escapeHtml((data?.locationName || '').toUpperCase().slice(0, 22));
  let day = '';
  let year = '';
  if (data?.timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: data.timezone,
      }).format(new Date());
      const m = parts.match(/^(\d+ \w+) (\d+)$/);
      day = (m?.[1] || '').toUpperCase();
      year = m?.[2] || '';
    } catch {}
  }
  const arcId = `pm-arc-${seed}`;
  // viewBox座標=mm。左に円形消印、右へ波線3本（はがき端でクリップされる）
  return `
  <svg style="position:absolute; left:${108 * p}px; top:${2 * p}px;
              transform:rotate(-6deg); mix-blend-mode:multiply; overflow:visible"
       width="${45 * p}" height="${26 * p}" viewBox="0 0 45 26">
    <g fill="none" stroke="${INK_BLUE}" stroke-width="0.4">
      <circle cx="21" cy="13" r="10"/>
      <circle cx="21" cy="13" r="7"/>
      <path d="M31.5 9.5 c2.5 -1.2 5 1.2 7.5 0 s5 1.2 8 0"/>
      <path d="M31.8 13 c2.5 -1.2 5 1.2 7.5 0 s5 1.2 8 0"/>
      <path d="M31.5 16.5 c2.5 -1.2 5 1.2 7.5 0 s5 1.2 8 0"/>
    </g>
    <defs><path id="${arcId}" d="M 13.6 10.8 A 7.75 7.75 0 0 1 28.4 10.8"/></defs>
    <text font-size="2.1" fill="${INK_BLUE}" font-family="Helvetica, Arial, sans-serif"
          letter-spacing="0.2">
      <textPath href="#${arcId}" startOffset="50%" text-anchor="middle">${loc}</textPath>
    </text>
    <text x="21" y="12.6" text-anchor="middle" font-size="2.5" fill="${INK_BLUE}"
          font-family="Helvetica, Arial, sans-serif">${day}</text>
    <text x="21" y="15.8" text-anchor="middle" font-size="2.5" fill="${INK_BLUE}"
          font-family="Helvetica, Arial, sans-serif">${year}</text>
  </svg>`;
}

// デザインごとの装飾DOM（.win-decorのinnerHTML）。座標はmm→px。
export function renderDecor(name, L, data, seed) {
  const p = L.pxMm;

  switch (name) {
    case 'stamp':
      return postmarkSvg(p, data, seed);

    case 'airmail': {
      const a = (3.2 * p).toFixed(1);
      const slice = Math.round(3 * p);
      return `
      <div style="position:absolute; inset:0; border:${3 * p}px solid transparent;
                  border-image:repeating-linear-gradient(45deg,
                    #b3402e 0 ${a}px, #f6f1e4 ${a}px ${2 * a}px,
                    #2b4a8b ${2 * a}px ${3 * a}px, #f6f1e4 ${3 * a}px ${4 * a}px) ${slice};"></div>`;
    }

    default:
      return '';
  }
}
