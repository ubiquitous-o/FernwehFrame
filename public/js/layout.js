// RÖDALM（3枚用フレーム）の物理ジオメトリ・レイアウト永続化・mm→px変換。
// フレーム/はがきのmm知識はこのモジュールに集約する（他モジュールはここから導出）。
// モニタとフレームの物理的な位置合わせはキャリブレーションモード（calibration.js）で調整。

// IKEA RÖDALM 3枚用 (外枠57×30cm, 窓13×18cm) を縦置きで使う (mm)
// → フレームは幅300×高さ570、横長窓(180×130)が縦に3つ並ぶ。
// 縦方向は等間隔配置と仮定: 45 + 130 + 45 + 130 + 45 + 130 + 45 = 570
export const RODALM = {
  frameW: 300,
  frameH: 570,
  winW: 180,
  winH: 130,
  marginX: 60,  // 左右余白 (300 - 180) / 2
  gapY: 45,     // 上下余白・窓間ギャップ（等間隔仮定）
  bleed: 5,     // 描画領域(180×130) → 額縁開口の実寸(170×120)の四辺ブリード
};

// はがきの既定実寸 (mm) = 日本のはがき。実際のサイズはlayout.card（キャリブレーションのPキー）で
// 変えられる。コンテンツ（フォント・余白・装飾）はこの既定サイズを1としたスケールkで追従する
export const POSTCARD = { w: 148, h: 100 };

// はがきサイズの可動範囲 (mm)。上限は窓の描画領域（それ以上は物理的に見えない）
export const CARD_LIMITS = { minW: 50, maxW: RODALM.winW, minH: 40, maxH: RODALM.winH };

export function clampCard(card) {
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return {
    w: Math.min(CARD_LIMITS.maxW, Math.max(CARD_LIMITS.minW, Math.round(num(card?.w, POSTCARD.w)))),
    h: Math.min(CARD_LIMITS.maxH, Math.max(CARD_LIMITS.minH, Math.round(num(card?.h, POSTCARD.h)))),
  };
}

// はがき内のコンテンツスケール。148×100を1として面積比の平方根で伸縮させる
// （縦横どちらが伸びても文字・余白がほどよく追従し、比率だけ変えたときは変わらない）
export function cardScale(card) {
  return Math.sqrt((card.w * card.h) / (POSTCARD.w * POSTCARD.h));
}

// はがき内デザイン定数 (mm, k=1のとき)。動画・キャプションの矩形はdesigns.jsが持つ
const CARD = {
  fontTitle: 3.0,
  fontMeta: 2.6,
};

// 額縁開口の実寸 (mm)
export function apertureMm() {
  return { w: RODALM.winW - 2 * RODALM.bleed, h: RODALM.winH - 2 * RODALM.bleed };
}

// ジオメトリ（RODALM定数・窓配置）を変えたらキーのバージョンを上げて古い保存値を無効化する。
// はがきサイズ(card)は後から追加したフィールドで、loadLayoutが旧保存値を既定で補完する
const STORAGE_KEY = 'ff_layout_v1';
// モニタの物理サイズ（表示領域の横幅mm）。実寸表示のためのpx/mm算出に使う。
// 既定値は本番モニター Newsoul 22MT01-S 縦置きの実測値（README参照）。
// 未設定のプロファイルでも起動した瞬間から実寸表示になる。別モニターは`C`→`M`で上書き
const DISPLAY_KEY = 'ff_display_v1';
const DEFAULT_DISPLAY_WIDTH_MM = 268;

export function getDisplayWidthMm() {
  const mm = parseFloat(localStorage.getItem(DISPLAY_KEY));
  return mm > 0 ? mm : DEFAULT_DISPLAY_WIDTH_MM;
}

export function setDisplayWidthMm(mm) {
  localStorage.setItem(DISPLAY_KEY, String(mm));
}

// モニタの表示領域横幅(mm)からpx/mmを算出。未設定ならnull。
export function getPxPerMm() {
  const mm = getDisplayWidthMm();
  return mm ? screen.width / mm : null;
}

// 窓の生成り背景の基準色（styles.cssの--bg-winデフォルトと対で管理）。
// キャリブレーションの明るさ係数(layout.bg)を乗じてCSS変数へ流す。
const BG_WIN_RGB = [231, 223, 204];
export const BG_BRIGHTNESS = { min: 0.2, max: 1.5, step: 0.02, bigStep: 0.1 };

export function applyBgBrightness(bg) {
  const rgb = BG_WIN_RGB.map((v) => Math.min(255, Math.round(v * bg))).join(', ');
  document.documentElement.style.setProperty('--bg-win', rgb);
}

// フレーム全体をモニタ中央に置くようoriginを設定
export function centerOrigin(layout) {
  layout.originX = (screen.width - RODALM.frameW * layout.scale) / 2;
  layout.originY = (screen.height - RODALM.frameH * layout.scale) / 2;
}

// デフォルトレイアウト：モニタの物理解像度(screen)基準で算出。
// ウィンドウサイズに依存しないため、リサイズしても表示サイズは変わらない。
// モニタ物理幅が設定済みなら真のpx/mm（=実寸表示）、未設定なら画面96%フィット。
export function defaultLayout() {
  const layout = {
    scale: getPxPerMm() ?? Math.min(
      (screen.width * 0.96) / RODALM.frameW,
      (screen.height * 0.96) / RODALM.frameH,
    ),
    originX: 0,
    originY: 0,
    bg: 1, // 窓の生成り背景の明るさ係数
    card: { ...POSTCARD }, // はがきの実寸 (mm)。全窓共通
    // 窓ごとの微調整 (px): 位置・サイズ
    wins: [0, 1, 2].map(() => ({ dx: 0, dy: 0, dw: 0, dh: 0 })),
  };
  centerOrigin(layout);
  return layout;
}

export function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.wins?.length === 3) {
        data.bg ??= 1; // bg導入前の保存値を補完
        data.card = clampCard(data.card); // card導入前の保存値は既定のはがきサイズに
        return data;
      }
    }
  } catch {}
  return defaultLayout();
}

export function saveLayout(layout) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

export function resetLayout() {
  localStorage.removeItem(STORAGE_KEY);
  return defaultLayout();
}

// 窓iのフレーム左上基準のmm矩形（縦置き: 上から窓1・2・3）
export function baseWindowMm(i) {
  return {
    x: RODALM.marginX,
    y: RODALM.gapY + i * (RODALM.winH + RODALM.gapY),
    w: RODALM.winW,
    h: RODALM.winH,
  };
}

// 窓iの画面px矩形
export function windowRect(layout, i) {
  const base = baseWindowMm(i);
  const adj = layout.wins[i];
  return {
    x: layout.originX + base.x * layout.scale + adj.dx,
    y: layout.originY + base.y * layout.scale + adj.dy,
    w: base.w * layout.scale + adj.dw,
    h: base.h * layout.scale + adj.dh,
  };
}

export function windowRects(layout) {
  return [0, 1, 2].map((i) => windowRect(layout, i));
}

// 要素に矩形pxを適用
export function setRectPx(el, r) {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

// 窓の描画矩形から、はがき・開口ガイドの矩形(px)とコンテンツスケールを導出。
// card は窓基準、aperture は窓基準。動画・キャプションの矩形はデザインごとに
// designs.jsのdesignLayoutがこの結果（pxMm / cardMm / k）から求める。
export function postcardLayout(rect, cardMm = POSTCARD) {
  const pxMm = rect.w / RODALM.winW;
  const k = cardScale(cardMm);

  const card = {
    x: ((RODALM.winW - cardMm.w) / 2) * pxMm,
    y: ((RODALM.winH - cardMm.h) / 2) * pxMm,
    w: cardMm.w * pxMm,
    h: cardMm.h * pxMm,
  };

  const bleed = RODALM.bleed * pxMm;
  const aperture = { x: bleed, y: bleed, w: rect.w - 2 * bleed, h: rect.h - 2 * bleed };

  return {
    pxMm,
    k,
    cardMm: { w: cardMm.w, h: cardMm.h },
    card,
    aperture,
    fontTitle: CARD.fontTitle * k * pxMm,
    fontMeta: CARD.fontMeta * k * pxMm,
  };
}
