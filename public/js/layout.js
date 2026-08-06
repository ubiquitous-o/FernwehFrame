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

// はがき実寸 (mm)
export const POSTCARD = { w: 148, h: 100 };

// はがき内デザイン定数 (mm)
const CARD = {
  pad: 3,       // はがき端 → コンテンツのマージン
  gap: 3,       // 動画とキャプションの間
  fontTitle: 3.0,
  fontMeta: 2.6,
};

// 額縁開口の実寸 (mm)
export function apertureMm() {
  return { w: RODALM.winW - 2 * RODALM.bleed, h: RODALM.winH - 2 * RODALM.bleed };
}

// ジオメトリ（RODALM定数・窓配置）を変えたらキーのバージョンを上げて古い保存値を無効化する
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
      if (data && data.wins?.length === 3) return data;
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

// 窓の描画矩形から、はがき・動画・キャプション・開口ガイドの各矩形(px)を導出。
// card/video/caption はカード内・カード基準、aperture は窓基準。
export function postcardLayout(rect) {
  const pxMm = rect.w / RODALM.winW;

  const card = {
    x: ((RODALM.winW - POSTCARD.w) / 2) * pxMm,
    y: ((RODALM.winH - POSTCARD.h) / 2) * pxMm,
    w: POSTCARD.w * pxMm,
    h: POSTCARD.h * pxMm,
  };

  const pad = CARD.pad * pxMm;
  const video = { x: pad, y: pad, w: card.w - 2 * pad, h: ((card.w - 2 * pad) * 9) / 16 };

  const capTop = pad + video.h + CARD.gap * pxMm;
  const caption = { x: pad, y: capTop, w: video.w, h: card.h - pad - capTop };

  const bleed = RODALM.bleed * pxMm;
  const aperture = { x: bleed, y: bleed, w: rect.w - 2 * bleed, h: rect.h - 2 * bleed };

  return {
    pxMm,
    card,
    video,
    caption,
    aperture,
    fontTitle: CARD.fontTitle * pxMm,
    fontMeta: CARD.fontMeta * pxMm,
  };
}
