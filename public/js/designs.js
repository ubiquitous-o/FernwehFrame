// 絵葉書のデザインバリアント。1窓=1デザインで、切替ごとにランダムに変わる
// （フォントと同じく他窓と被らないよう選ぶ）。?design=名前 で全窓固定（確認用）。
// 各デザインは designLayout()（動画・キャプションの矩形とクリップ）と
// renderDecor()（消印・罫線・テープ等の装飾DOM）の2つで定義する。
// 座標系はすべてはがき基準のmm。px化はlayout.jsのpxMm（L.pxMm）で行う。
import { POSTCARD } from './layout.js';

export const DESIGNS = [
  'stamp',        // 切手ミシン目 + 丸消印
  'airmail',      // 赤青ストライプのエアメール
  'fullbleed',    // 全面写真 + 余白にキャプション
  'letters',      // 地名の極太文字マスク越しに動画が見える
];

// 切手のミシン目 (mm)
const PERF = { r: 1, step: 3.5 };
// はがき端 → コンテンツのマージン / 動画とキャプションの間 (mm)
const PAD = 3;
const GAP = 3;

const INK_BLUE = 'rgba(43, 74, 139, 0.68)';   // 消印インク

const FORCED = new URLSearchParams(location.search).get('design');

// 除外リスト（先頭=自窓の現在、以降=他窓の現在）を避けてランダムに選ぶ。
// デザインが4種以上あれば「毎回必ず変わる」かつ「3窓常にバラバラ」が両立する
// （4種ちょうどだと候補は常に1つ=空いているデザインで、動きは決定的になる。
// 5種以上に増えれば自動でランダム性が戻る）。?design=指定時は常にそれ。
// フォールバック: 候補が空（デザイン数が窓数以下）なら他窓との被り回避を優先して
// 自窓の現在を維持し、それも無理なら循環順で次へ送る。
export function pickDesign(exclude) {
  if (FORCED && DESIGNS.includes(FORCED)) return FORCED;
  const pool = DESIGNS.filter((d) => !exclude.includes(d));
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  const pool2 = DESIGNS.filter((d) => !exclude.slice(1).includes(d));
  return pool2.length
    ? pool2[Math.floor(Math.random() * pool2.length)]
    : DESIGNS[(DESIGNS.indexOf(exclude[0]) + 1) % DESIGNS.length];
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

// 動画メタ由来のテキスト（YouTube/パイプライン産＝非信頼）をHTMLに埋める前にエスケープする
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 地名の行分割（lettersデザイン用）: 短めに詰めて行数を稼ぎ、縦方向も埋める。最大4行
function lettersLines(data) {
  const loc = (data?.locationName || 'Somewhere').toUpperCase().replace(/,/g, '');
  const words = loc.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length > 7 && cur) { lines.push(cur); cur = w; } else { cur = cand; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

// lettersデザインで使う書体。動画ごとにランダムに選ぶ
const LETTER_FONTS = ['Climate Crisis', 'Oi', 'Ultra'];

// 抽選結果はvideoIdごとに保持する
// （キャリブレーション中のre-render等で書体が変わらないように）
const letterFontChoice = new Map();
function pickLetterFont(data) {
  const id = data?.videoId || '';
  if (!letterFontChoice.has(id)) {
    letterFontChoice.set(id, LETTER_FONTS[Math.floor(Math.random() * LETTER_FONTS.length)]);
  }
  return letterFontChoice.get(id);
}

// 地名タイポグラフィの<clipPath>定義（lettersデザイン用）。
// Webフォントを使うため、画像扱いのdata URIマスクではなく
// インラインSVGの<clipPath>＋<text>で文字の形に動画を切り抜く
// （HTML要素へのmask: url(#id)参照はChromeが未対応。clip-path参照は効く）。
//
// レイアウトは実測フィット。要件（全書体共通）:
//   1. 上下左右のマージンまでギリギリに引き伸ばす
//   2. 2行以上のとき行間は0
// canvasのmeasureText().actualBoundingBox*でインク（実際に描かれる形）の
// 実寸を測り、各行のインクが自分の帯（幅142mm × 行高）にぴったり一致する
// transformを計算する。SVGテキストのgetBBox()は書体のem枠（内部余白込み）を
// 返してしまい行間が空くため使わない。
// clipPathUnits=userSpaceOnUseなので座標は対象要素のpx（mm×p）。
const measureCtx = document.createElement('canvas').getContext('2d');

function lettersClipDefs(p, data, seed) {
  const shown = lettersLines(data);
  const FAMILY = pickLetterFont(data);
  const M = 4;   // 上下マージン: fullbleedと同じ。タイトル/時刻の帯（CSS）もここ
  const X = 3;   // 左右マージン
  const lh = (POSTCARD.h - 2 * M) / shown.length; // 行間0で等分
  const targetW = POSTCARD.w - 2 * X;
  const fontAttr = `'${FAMILY}', 'Arial Black', Arial, sans-serif`;

  measureCtx.font = `100px "${FAMILY}", "Arial Black", Arial, sans-serif`;
  const texts = shown.map((t, i) => {
    const m = measureCtx.measureText(t);
    const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (!inkW || !inkH) return '';
    // 描画はx=0,y=0（ベースライン）: インクはx∈[-left, right], y∈[-ascent, descent]
    const sx = (targetW * p) / inkW;
    const sy = (lh * p) / inkH;
    const tx = X * p + sx * m.actualBoundingBoxLeft;
    const ty = (M + lh * i) * p + sy * m.actualBoundingBoxAscent;
    return `<text transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})"
    font-family="${fontAttr}" font-size="100">${escapeHtml(t)}</text>`;
  }).join('');
  return `
  <svg width="0" height="0" style="position:absolute">
    <defs><clipPath id="letters-clip-${seed}" clipPathUnits="userSpaceOnUse">${texts}</clipPath></defs>
  </svg>`;
}

// デザインごとの矩形・クリップ。
// 戻り値: { video, caption (px), clip (動画ボックスのclip-path値|null),
//           videoInner (カバークロップ用の内側矩形|null) }
// lettersのclipは<clipPath>参照で、本体はrenderDecorが同じseedで埋める
export function designLayout(name, L, data, seed) {
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
      d.clip = `path('${stampPath(d.video.w, d.video.h, PERF.r * p, PERF.step * p)}')`;
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
    case 'letters': {
      // 動画をはがき全面に敷き、地名の文字マスク越しにだけ見せる。
      // タイトル/時刻はfullbleedと同じ4mmのマージン帯に置く（CSS .design-letters）
      const coverW = (H * 16) / 9;
      return {
        video: rectPx(p, 0, 0, W, H),
        caption: rectPx(p, 4, 0, W - 8, H),
        videoInner: rectPx(p, (W - coverW) / 2, 0, coverW, H),
        clip: `url(#letters-clip-${seed})`,
      };
    }
    default:
      return base();
  }
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

    case 'letters':
      return lettersClipDefs(p, data, seed);

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
