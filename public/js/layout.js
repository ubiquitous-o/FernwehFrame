// RÖDALM（3枚用フレーム）の物理ジオメトリとレイアウト永続化。
// mm実寸をベースに、px/mmスケール＋オフセットで画面座標へ変換する。
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
};

// ジオメトリ（RODALM定数・窓配置）を変えたらキーのバージョンを上げて古い保存値を無効化する
const STORAGE_KEY = 'nwf_layout_v2';
// モニタの物理サイズ（表示領域の横幅mm）。実寸表示のためのpx/mm算出に使う
const DISPLAY_KEY = 'nwf_display_v1';

// モニタの表示領域横幅(mm)からpx/mmを算出。未設定ならnull。
export function getPxPerMm() {
  const mm = parseFloat(localStorage.getItem(DISPLAY_KEY));
  return mm > 0 ? screen.width / mm : null;
}

export function setDisplayWidthMm(mm) {
  localStorage.setItem(DISPLAY_KEY, String(mm));
}

export function getDisplayWidthMm() {
  const mm = parseFloat(localStorage.getItem(DISPLAY_KEY));
  return mm > 0 ? mm : null;
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

// デフォルトレイアウト：モニタの物理解像度(screen)基準で算出。
// ウィンドウサイズに依存しないため、リサイズしても表示サイズは変わらない。
// キオスクではフルスクリーン前提（viewport = screen）なので中央配置も正しくなる。
// モニタ物理幅が設定済みなら真のpx/mm（=実寸表示）、未設定なら画面96%フィット。
export function defaultLayout() {
  const scale = getPxPerMm() ?? Math.min(
    (screen.width * 0.96) / RODALM.frameW,
    (screen.height * 0.96) / RODALM.frameH,
  );
  return {
    saved: false,
    scale,
    originX: (screen.width - RODALM.frameW * scale) / 2,
    originY: (screen.height - RODALM.frameH * scale) / 2,
    // 窓ごとの微調整 (px): 位置・サイズ
    wins: [0, 1, 2].map(() => ({ dx: 0, dy: 0, dw: 0, dh: 0 })),
  };
}

export function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.wins?.length === 3) {
        data.saved = true;
        return data;
      }
    }
  } catch {}
  return defaultLayout();
}

export function saveLayout(layout) {
  layout.saved = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

export function resetLayout() {
  localStorage.removeItem(STORAGE_KEY);
  return defaultLayout();
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
