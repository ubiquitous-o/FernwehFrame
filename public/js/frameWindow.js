// 1窓 = 1コントローラ。プレイヤー生成・すりガラス遷移・リトライ・キャプション表示を担当。
// mm→px のレイアウト計算は layout.js（postcardLayout）に集約されており、
// ここでは返ってきた矩形をスタイルに流すだけ。
// 3窓それぞれが独立に動き、切替タイミングはmain.jsがスタガーさせる。
import { createPlayer, destroyPlayer } from './player.js';
import { fetchNext } from './videoPool.js';
import { setRectPx, postcardLayout } from './layout.js';

// YT embedが切替時に出すタイトル/ロゴ等のintro UIが消えるまで曇りで覆う時間
const POST_LOAD_HOLD_MS = 3700;
// ガラスが曇り切る/晴れるまでの時間。CSS変数 --frost-ms が唯一のソース。
const FROST_MS = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue('--frost-ms'),
) || 900;
const MAX_ATTEMPTS = 4;       // 1回の切替で試す動画数
const RETRY_DELAY_MS = 500;
const FAIL_RETRY_MS = 15000;  // 全滅時に再挑戦するまでの待ち
const CLOCK_TICK_MS = 30000;

// 切手のミシン目 (mm)
const PERF = { r: 1, step: 2.8 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// キャプション用フォント（Google Fonts）。ポストカード1枚 = 1書体、切替ごとにランダム。
// このリストが唯一のソース：main.jsがここからcss2 URLを組み立てて<link>を注入する。
// Latin専用書体が多いため、日本語タイトルはフォールバック（Hiragino）で描画される。
export const FONTS = [
  // Expressive / Innovative
  'Sonsie One',
  // Expressive / Happy
  'Slackey',
  // Expressive / Business
  'Merriweather',
  'Roboto Flex',
  // Expressive / Fancy
  'Lobster',
  // Expressive / Artistic
  'Bitcount',
  'Permanent Marker',
  // Serif / Transitional
  'Newsreader',
  'Gilda Display',
  'Gupter',
  // Theme / Brush
  'Knewave',
  'Margarine',
  'Coming Soon',
  'Vampiro One',
  // Theme / Art Deco
  'Ribeye',
  // Theme / Tuscan
  'Sancreek',
  // Theme / Techno
  'Audiowide',
];

// 除外リスト（自窓の直前の書体＋他窓の現在の書体）を避けて選ぶ
function pickFont(exclude) {
  const pool = FONTS.filter((f) => !exclude.includes(f));
  return pool[Math.floor(Math.random() * pool.length)];
}

// 切手のミシン目風クリップパス: 矩形の全周に半円ノッチを等間隔で刻む
function stampPath(w, h, r, step) {
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

export class FrameWindow {
  constructor(index, rootEl, getExcludeIds, getExcludeFonts) {
    this.index = index;
    this.rootEl = rootEl;
    this.cardEl = rootEl.querySelector('.win-card');
    this.apertureEl = rootEl.querySelector('.cal-aperture');
    this.videoBoxEl = rootEl.querySelector('.win-video-box');
    this.videoEl = rootEl.querySelector('.win-video');
    this.titleEl = rootEl.querySelector('.win-title');
    this.locationEl = rootEl.querySelector('.win-location');
    this.timeEl = rootEl.querySelector('.win-time');
    this.metaEl = rootEl.querySelector('.win-meta');
    this.captionEl = rootEl.querySelector('.win-caption');
    this.frostEl = rootEl.querySelector('.win-frost');
    this.getExcludeIds = getExcludeIds;
    this.getExcludeFonts = getExcludeFonts;

    this.player = null;
    this.current = null;      // 再生中の動画メタデータ
    this.currentFont = null;  // このポストカードの現在の書体
    this.isSwitching = false;
    this.clockTimer = null;
    this.retryTimer = null;
    this.frostOffTimer = null;
    this.clipKey = null;      // stampPath再生成を省くためのサイズキー
  }

  // 画面px矩形を適用。内部レイアウトはlayout.jsが導出した矩形を流し込むだけ。
  applyRect(rect) {
    setRectPx(this.rootEl, rect);
    const L = postcardLayout(rect);
    setRectPx(this.cardEl, L.card);
    setRectPx(this.videoBoxEl, L.video);
    setRectPx(this.captionEl, L.caption);
    setRectPx(this.apertureEl, L.aperture);
    this.titleEl.style.fontSize = `${L.fontTitle}px`;
    this.metaEl.style.fontSize = `${L.fontMeta}px`;

    // ミシン目パスはサイズが変わったときだけ再生成（キャリブレーションの移動連打対策）
    const clipKey = `${L.video.w.toFixed(2)}x${L.video.h.toFixed(2)}`;
    if (clipKey !== this.clipKey) {
      this.clipKey = clipKey;
      this.videoBoxEl.style.clipPath =
        `path('${stampPath(L.video.w, L.video.h, PERF.r * L.pxMm, PERF.step * L.pxMm)}')`;
    }
  }

  // --- すりガラス ---
  // アイドル時はbackdrop-filterを完全に外す（常時GPUコスト回避）。
  // 遷移中のみ .frost-on でblur(0)を持たせ、.active への変化をtransitionさせる。

  showFrost() {
    clearTimeout(this.frostOffTimer);
    this.frostEl.classList.add('frost-on');
    // blur(0)が適用されたフレームを挟んでからactiveにしないとtransitionが発火しない
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.frostEl.classList.add('active');
    }));
  }

  hideFrost() {
    this.frostEl.classList.remove('active');
    this.frostOffTimer = setTimeout(() => {
      this.frostEl.classList.remove('frost-on');
    }, FROST_MS + 100);
  }

  // --- キャプション ---

  stopClock() {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  clearCaption() {
    this.stopClock();
    this.titleEl.textContent = '';
    this.locationEl.textContent = '';
    this.timeEl.textContent = '';
  }

  setCaption(data) {
    const exclude = [this.currentFont, ...this.getExcludeFonts()].filter(Boolean);
    this.currentFont = pickFont(exclude);
    console.log(`[win${this.index}] font: ${this.currentFont}`);
    this.captionEl.style.fontFamily = `'${this.currentFont}', 'Hiragino Sans', sans-serif`;
    this.titleEl.textContent = data.title || '';
    this.titleEl.title = data.title || '';
    this.locationEl.textContent = data.locationName || 'Location unknown';
    this.startClock(data.timezone);
  }

  startClock(timezone) {
    this.stopClock();
    if (!timezone) { this.timeEl.textContent = ''; return; }
    let fmt;
    try {
      fmt = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
      });
    } catch {
      this.timeEl.textContent = '';
      return;
    }
    const tick = () => { this.timeEl.textContent = fmt.format(new Date()); };
    tick();
    this.clockTimer = setInterval(tick, CLOCK_TICK_MS);
  }

  // --- 切替 ---

  // 次の動画へ切替。失敗したら別の動画でリトライ、全滅ならFAIL_RETRY_MS後に再挑戦。
  async switchNext() {
    if (this.isSwitching) return;
    this.isSwitching = true;
    clearTimeout(this.retryTimer);

    // ガラスが曇り切るのを待ってから旧映像を破棄（曇りの途中は旧映像が透けている）
    this.showFrost();
    await sleep(FROST_MS + 100);
    this.clearCaption();

    destroyPlayer(this.player, this.videoEl);
    this.player = null;
    this.current = null;

    let success = false;
    let data;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        data = await fetchNext(this.getExcludeIds());
      } catch (err) {
        console.error(`[win${this.index}] fetchNext failed:`, err?.message || err);
        break;
      }
      try {
        this.player = await createPlayer(this.videoEl, data.videoId);
        this.current = data;
        success = true;
        console.log(`[win${this.index}] ▶ "${data.title}" (${data.channel})`);
        break;
      } catch (err) {
        console.warn(`[win${this.index}] attempt ${attempt} failed:`, err?.message || err);
        await sleep(RETRY_DELAY_MS);
      }
    }

    if (!success) {
      this.isSwitching = false;
      this.retryTimer = setTimeout(() => this.switchNext(), FAIL_RETRY_MS);
      return;
    }

    // intro UIが消えるまで曇ったまま待ち、キャプションを整えてからゆっくり晴らす
    await sleep(POST_LOAD_HOLD_MS);
    this.setCaption(data);
    this.hideFrost();
    this.isSwitching = false;
  }
}
