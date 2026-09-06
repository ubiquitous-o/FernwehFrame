// 絵葉書のデザインバリアント。1窓=1デザインで、切替ごとにランダムに変わる
// （フォントと同じく他窓と被らないよう選ぶ）。?design=名前 で全窓固定（確認用）。
// 各デザインは designLayout()（動画・キャプションの矩形とクリップ）と
// renderDecor()（消印・罫線・テープ等の装飾DOM）の2つで定義する。
// 座標系はすべてはがき基準のmm。px化はlayout.jsのpxMm（L.pxMm）で行う。
//
// はがきサイズは可変（layout.card / L.cardMm）。各デザインは W×H から矩形を組み立て、
// 余白・文字・装飾の寸法は既定の148×100を1とするコンテンツスケール L.k で伸縮する。
// 16:9の動画は幅優先で敷くが、比率が縦長寄りでキャプション帯が潰れるときは
// 高さ側に合わせて縮め、左右中央に置く（「良い感じ」の要）。

export const DESIGNS = [
  'stamp',        // 切手ミシン目 + 丸消印
  'airmail',      // 赤青ストライプのエアメール
  'fullbleed',    // 全面写真 + 余白にキャプション
  'letters',      // 地名の極太文字マスク越しに動画が見える
];

// 切手のミシン目 (mm, k=1)
const PERF = { r: 1, step: 3.5 };
// はがき端 → コンテンツのマージン / 動画とキャプションの間 (mm, k=1)
const PAD = 3;
const GAP = 3;
// 標準（stamp）のキャプション帯の高さ範囲 (mm, k=1)。
// 最小=タイトル+メタの2行が入る高さ。最大を超える余りは上下の余白に等分する
const CAP_MIN = 9;
const CAP_MAX = 16;
// エアメール: 縁の帯幅 / コンテンツの内寄せ / 動画上下に残す文字帯 (mm, k=1)
const AIRMAIL_BAND = 4;
const AIRMAIL_PAD = 7.5;
const AIRMAIL_TEXT = 5;
// フルブリードの紙マージン (mm, k=1)
const FULLBLEED_PAD = 4;

const INK_BLUE = 'rgba(33, 60, 122, 0.82)';   // 消印インク

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

// 16:9の動画を幅 vw に敷いたときの高さ。ただし帯 vhMax を超えるなら高さ側に合わせて
// 幅を縮める（比率が縦長寄りのはがきでキャプション帯を潰さない）
function fitVideo(vw, vhMax) {
  let vh = (vw * 9) / 16;
  if (vh > vhMax) {
    vh = Math.max(1, vhMax);
    vw = (vh * 16) / 9;
  }
  return { vw, vh };
}

// 枠(vw×vh mm)を16:9でカバーする（はみ出す側を中央クロップ）内側矩形(px)
function coverRect(p, vw, vh) {
  const s = Math.max(vw / 16, vh / 9);
  const cw = 16 * s;
  const ch = 9 * s;
  return rectPx(p, (vw - cw) / 2, (vh - ch) / 2, cw, ch);
}

// 動画メタ由来のテキスト（YouTube/パイプライン産＝非信頼）をHTMLに埋める前にエスケープする
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 地名の行分割（lettersデザイン用）: 短めに詰めて行数を稼ぎ、縦方向も埋める。
// 1行の文字数上限と最大行数ははがきの縦横比に追従する（148×100で7文字・4行）:
// 横長なら長い行を少なく、縦長なら短い行を多く
function lettersLines(data, W, H) {
  const ratio = W / H;
  const maxChars = Math.max(3, Math.round(7 * ratio / 1.48));
  const maxLines = Math.min(8, Math.max(2, Math.round(4 * 1.48 / ratio)));
  const loc = (data?.locationName || 'Somewhere').toUpperCase().replace(/,/g, '');
  const words = loc.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length > maxChars && cur) { lines.push(cur); cur = w; } else { cur = cand; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
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

// lettersデザインのマージン (mm, k=1)。上下はfullbleedと同じ。タイトル/時刻の帯もここ
const LETTERS_M = 4;  // 上下
const LETTERS_X = 3;  // 左右

// 地名タイポグラフィの<clipPath>定義（lettersデザイン用）。
// Webフォントを使うため、画像扱いのdata URIマスクではなく
// インラインSVGの<clipPath>＋<text>で文字の形に動画を切り抜く
// （HTML要素へのmask: url(#id)参照はChromeが未対応。clip-path参照は効く）。
//
// レイアウトは実測フィット。要件（全書体共通）:
//   1. 上下左右のマージンまでギリギリに引き伸ばす
//   2. 2行以上のとき行間は0
// canvasのmeasureText().actualBoundingBox*でインク（実際に描かれる形）の
// 実寸を測り、各行のインクが自分の帯（幅W-2X × 行高）にぴったり一致する
// transformを計算する。SVGテキストのgetBBox()は書体のem枠（内部余白込み）を
// 返してしまい行間が空くため使わない。
// clipPathUnits=userSpaceOnUseなので座標は対象要素のpx（mm×p）。
const measureCtx = document.createElement('canvas').getContext('2d');

function lettersClipDefs(L, data, seed) {
  const { pxMm: p, k } = L;
  const W = L.cardMm.w;
  const H = L.cardMm.h;
  const shown = lettersLines(data, W, H);
  const FAMILY = pickLetterFont(data);
  const M = LETTERS_M * k;
  const X = LETTERS_X * k;
  const lh = (H - 2 * M) / shown.length; // 行間0で等分
  const targetW = W - 2 * X;
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
//           videoInner (カバークロップ用の内側矩形|null),
//           band (余白帯にキャプションを置くデザインの帯高さpx|null → CSS --band) }
// lettersのclipは<clipPath>参照で、本体はrenderDecorが同じseedで埋める
export function designLayout(name, L, data, seed) {
  const { pxMm: p, k } = L;
  const W = L.cardMm.w;
  const H = L.cardMm.h;
  const base = () => {
    // 動画を上、キャプションを下に。キャプション帯はCAP_MIN〜CAP_MAXに収め、
    // 余りは上下の余白に等分（148×100ではぴったり埋まり余白はPADのまま）
    const pad = PAD * k;
    const gap = GAP * k;
    const innerW = W - 2 * pad;
    const innerH = H - 2 * pad;
    const { vw, vh } = fitVideo(innerW, innerH - gap - CAP_MIN * k);
    const capH = Math.max(1, Math.min(innerH - vh - gap, CAP_MAX * k));
    const top = pad + (innerH - (vh + gap + capH)) / 2;
    const left = (W - vw) / 2;
    return {
      video: rectPx(p, left, top, vw, vh),
      caption: rectPx(p, left, top + vh + gap, vw, capH),
      clip: null,
      videoInner: null,
      band: null,
    };
  };

  switch (name) {
    case 'stamp': {
      const d = base();
      d.clip = `path('${stampPath(d.video.w, d.video.h, PERF.r * k * p, PERF.step * k * p)}')`;
      return d;
    }
    case 'airmail': {
      // 縁の赤青ストライプ分だけコンテンツを内側に寄せ、動画は中央に置く。
      // キャプションはコンテンツ領域全体に広げ、CSS（.design-airmail）が
      // タイトルを上余白の中央揃え・メタを下余白に振り分ける。
      // 動画の上下にはタイトル/メタ用の帯（AIRMAIL_TEXT）を必ず残す
      const pad = AIRMAIL_PAD * k;
      const innerW = W - 2 * pad;
      const innerH = H - 2 * pad;
      const { vw, vh } = fitVideo(innerW, innerH - 2 * AIRMAIL_TEXT * k);
      return {
        video: rectPx(p, (W - vw) / 2, (H - vh) / 2, vw, vh),
        caption: rectPx(p, pad, pad, innerW, innerH),
        clip: null,
        videoInner: null,
        band: null,
      };
    }
    case 'fullbleed': {
      // 四辺同じ細い紙マージンを残して動画を大きく敷く（16:9をカバーで中央クロップ）。
      // キャプションは余白の帯に書く: タイトル=左上、時刻=右上、地名=右下。
      // 文字の配置はCSS（.design-fullbleed）が帯の高さ（--band = pad）に合わせて行う
      const pad = FULLBLEED_PAD * k;
      const vw = W - 2 * pad;
      const vh = H - 2 * pad;
      return {
        video: rectPx(p, pad, pad, vw, vh),
        caption: rectPx(p, pad, 0, vw, H),
        clip: null,
        videoInner: coverRect(p, vw, vh),
        band: pad * p,
      };
    }
    case 'letters': {
      // 動画をはがき全面に敷き、地名の文字マスク越しにだけ見せる。
      // タイトル/時刻はfullbleedと同じ上下マージン帯に置く（CSS .design-letters）
      const m = LETTERS_M * k;
      return {
        video: rectPx(p, 0, 0, W, H),
        caption: rectPx(p, m, 0, W - 2 * m, H),
        videoInner: coverRect(p, W, H),
        clip: `url(#letters-clip-${seed})`,
        band: m * p,
      };
    }
    default:
      return base();
  }
}

// 丸消印 + 波線（切手デザイン用）。data からカメラ現地の地名・日付を入れる。
// 動画の右上角に少し重ねて置く（video = designLayoutのstampの動画矩形px）
function postmarkSvg(L, data, seed, video) {
  const { pxMm: p, k } = L;
  // 弧は下側30°を除く330°（全長約45mm）。フォント2.1mm固定で28文字まで入る。
  // textPathは弧からあふれた文字を描かないため、上限は弧長に合わせる
  const loc = escapeHtml((data?.locationName || 'Somewhere').toUpperCase().slice(0, 28));
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
  // 148×100では動画右端145mm・上端3mmに対して left=108, top=2 だった配置を相対化
  const left = video.x + video.w - 37 * k * p;
  const top = video.y - 1 * k * p;
  // viewBox座標=mm。左に円形消印、右へ波線3本（はがき端でクリップされる）
  return `
  <svg style="position:absolute; left:${left}px; top:${top}px;
              transform:rotate(-6deg); overflow:visible;
              filter:drop-shadow(0 0 ${0.1 * k * p}px rgba(249,244,244,0.55))"
       width="${45 * k * p}" height="${26 * k * p}" viewBox="0 0 45 26">
    <g fill="none" stroke="${INK_BLUE}" stroke-width="0.55">
      <circle cx="21" cy="13" r="10"/>
      <circle cx="21" cy="13" r="7"/>
      <path d="M31.5 9.5 c2.5 -1.2 5 1.2 7.5 0 s5 1.2 8 0"/>
      <path d="M31.8 13 c2.5 -1.2 5 1.2 7.5 0 s5 1.2 8 0"/>
      <path d="M31.5 16.5 c2.5 -1.2 5 1.2 7.5 0 s5 1.2 8 0"/>
    </g>
    <defs><path id="${arcId}" d="M 18.99 20.49 A 7.75 7.75 0 1 1 23.01 20.49"/></defs>
    <text font-size="2.1" font-weight="bold" fill="${INK_BLUE}"
          font-family="Helvetica, Arial, sans-serif" letter-spacing="0.2">
      <textPath href="#${arcId}" startOffset="50%" text-anchor="middle">${loc}</textPath>
    </text>
    ${day ? `
    <text x="21" y="12.6" text-anchor="middle" font-size="2.5" font-weight="bold" fill="${INK_BLUE}"
          font-family="Helvetica, Arial, sans-serif">${day}</text>
    <text x="21" y="15.8" text-anchor="middle" font-size="2.5" font-weight="bold" fill="${INK_BLUE}"
          font-family="Helvetica, Arial, sans-serif">${year}</text>` : `
    <g fill="none" stroke="${INK_BLUE}" stroke-width="0.55">
      <rect x="17.6" y="10.6" width="6.8" height="4.8" rx="0.4"/>
      <path d="M 17.8 10.9 L 21 13.3 L 24.2 10.9"/>
    </g>`}
  </svg>`;
}

// エアメールの縁の赤青ストライプ（W×H mmのはがき用）。
// すべての平行四辺形を完全な形で描く（端で切れない）。座標=mm。
// 帯幅 b、縞:余白=1:1。ブロック幅は目標 f0 に最も近い奇数個で各辺にぴったり収める:
// 縦帯は端の余白なし（(2n-1)f + b = H - b）、横帯は両端に余白 mH を持たせて
// 左右の端にぴったりはめない。148×100では f=92/9、縦5個・横7個・mH≈3.6mm で
// 従来の配置と一致する。縦横で f がわずかに異なりうるが同一辺内では均一。
// 帯は実物の封筒と同じ風車配置（上=左上角、右=右上角、下=右下角、左=左下角）。
// 下帯・左帯は上帯・右帯の180°回転。縦帯の傾きは左肩上がり。
// 個数がどちらも奇数なので、横帯=赤始まり・縦帯=青始まりで角をまたいで赤青が
// 完全に交互になる（180°回転側もそのまま成立）。
// パターンではなく明示的なpathなので位相合わせ不要・アンチエイリアスも効く。
function airmailSvg(L) {
  const { pxMm: p, k } = L;
  const W = L.cardMm.w;
  const H = L.cardMm.h;
  const b = AIRMAIL_BAND * k;
  const f0 = (92 / 9) * k;
  const mH = 0.35 * f0;
  // 長さ len に (2n-1) 個のブロック幅 f を奇数個 n でぴったり収める
  const fit = (len) => {
    // 目標個数 x=(len/f0+1)/2 に最も近い奇数 n=2m-1（m=round((x+1)/2)）
    const m = Math.max(1, Math.round((len / f0 + 3) / 4));
    const n = 2 * m - 1;
    return { n, f: len / (2 * n - 1) };
  };
  const v = fit(H - 2 * b);           // 縦帯（余白なし）
  const h = fit(W - 2 * b - 2 * mH);  // 横帯（両端に mH）
  const RED = '#de4430';
  const BLUE = '#2c3f7d';
  const blocks = [];
  for (let i = 0; i < h.n; i++) {
    const x = mH + i * 2 * h.f;
    const c = i % 2 ? BLUE : RED;
    const f = h.f;
    // 上帯（左端→右端-帯幅）と、その180°回転の下帯
    blocks.push(`<path d="M ${x} ${b} L ${x + b} 0 L ${x + b + f} 0 L ${x + f} ${b} Z" fill="${c}"/>`);
    blocks.push(`<path d="M ${W - x} ${H - b} L ${W - x - b} ${H} L ${W - x - b - f} ${H} L ${W - x - f} ${H - b} Z" fill="${c}"/>`);
  }
  for (let i = 0; i < v.n; i++) {
    const y = i * 2 * v.f;
    const c = i % 2 ? RED : BLUE;
    const f = v.f;
    // 右帯（上端→下端-帯幅）と、その180°回転の左帯。傾きは左肩上がり
    blocks.push(`<path d="M ${W - b} ${y} L ${W} ${y + b} L ${W} ${y + b + f} L ${W - b} ${y + f} Z" fill="${c}"/>`);
    blocks.push(`<path d="M ${b} ${H - y} L 0 ${H - y - b} L 0 ${H - y - b - f} L ${b} ${H - y - f} Z" fill="${c}"/>`);
  }
  return `
  <svg style="position:absolute; inset:0" width="${W * p}" height="${H * p}"
       viewBox="0 0 ${W} ${H}">${blocks.join('')}
  </svg>`;
}

// デザインごとの装飾DOM（.win-decorのinnerHTML）。座標はmm→px。
// D は同じデザインの designLayout() の結果（動画矩形に相対配置する装飾用）
export function renderDecor(name, L, data, seed, D) {
  switch (name) {
    case 'stamp':
      return postmarkSvg(L, data, seed, D.video);
    case 'letters':
      return lettersClipDefs(L, data, seed);
    case 'airmail':
      return airmailSvg(L);
    default:
      return '';
  }
}
