// 1窓 = 1コントローラ。プレイヤー生成・すりガラス遷移・リトライ・矩形適用・キャプション表示を担当。
// 3窓それぞれが独立に動き、切替タイミングはmain.jsがスタガーさせる。
//
// 窓の中身は「ポストカード」レイアウト:
//   描画領域180×130mm / 額縁の開口実寸170×120mm（四辺5mmブリード）
//   上部: 16:9原寸比の動画（クロップなし、セーフエリアから更にマージン）
//   下部: タイトル / 地名 / 現地時間
import { createPlayer, destroyPlayer } from './player.js';
import { fetchNext } from './videoPool.js';
import { RODALM } from './layout.js';

// YT embedが切替時に出すタイトル/ロゴ等のintro UIが消えるまで曇りで覆う時間
const POST_LOAD_HOLD_MS = 3700;
// ガラスが曇り切る/晴れるまでの時間（CSSのtransitionと合わせる）
const FROST_MS = 900;
const MAX_ATTEMPTS = 4;       // 1回の切替で試す動画数
const RETRY_DELAY_MS = 500;
const FAIL_RETRY_MS = 15000;  // 全滅時に再挑戦するまでの待ち
const CLOCK_TICK_MS = 30000;

// ポストカードレイアウト定数 (mm)
// 描画領域180×130 ⊃ 開口実寸170×120（四辺5mmブリード） ⊃ はがき実寸148×100（中央）
const MM = {
  bleed: 5,     // 描画領域 → 開口実寸のブリード
  cardW: 148,   // はがき実寸
  cardH: 100,
  pad: 3,       // はがき端 → コンテンツのマージン
  gap: 3,       // 動画とキャプションの間
  perfR: 1,     // ミシン目の半径
  perfStep: 2.8, // ミシン目の間隔
  fontTitle: 3.0,
  fontMeta: 2.6,
};

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
  constructor(index, rootEl, getExcludeIds) {
    this.index = index;
    this.rootEl = rootEl;
    this.cardEl = rootEl.querySelector('.win-card');
    this.apertureEl = rootEl.querySelector('.cal-aperture');
    this.postcardEl = rootEl.querySelector('.cal-postcard');
    this.videoBoxEl = rootEl.querySelector('.win-video-box');
    this.videoEl = rootEl.querySelector('.win-video');
    this.titleEl = rootEl.querySelector('.win-title');
    this.locationEl = rootEl.querySelector('.win-location');
    this.timeEl = rootEl.querySelector('.win-time');
    this.captionEl = rootEl.querySelector('.win-caption');
    this.frostEl = rootEl.querySelector('.win-frost');
    this.getExcludeIds = getExcludeIds;

    this.player = null;
    this.current = null;      // 再生中の動画メタデータ
    this.isSwitching = false;
    this.clockTimer = null;
    this.rect = { x: 0, y: 0, w: 100, h: 100 };
  }

  // 画面px矩形を適用し、ポストカード内部（動画・キャプション）をmm定数から配置する。
  applyRect(rect) {
    this.rect = rect;
    const s = this.rootEl.style;
    s.left = `${rect.x}px`;
    s.top = `${rect.y}px`;
    s.width = `${rect.w}px`;
    s.height = `${rect.h}px`;

    // px/mm はこの窓の実描画幅から導出（キャリブレーションのdw/dhにも追従）
    const pxMm = rect.w / RODALM.winW;

    // はがき本体: 描画領域の中央に実寸配置
    const cardX = ((RODALM.winW - MM.cardW) / 2) * pxMm;
    const cardY = ((RODALM.winH - MM.cardH) / 2) * pxMm;
    const cardW = MM.cardW * pxMm;
    const cardH = MM.cardH * pxMm;
    const card = this.cardEl.style;
    card.left = `${cardX}px`;
    card.top = `${cardY}px`;
    card.width = `${cardW}px`;
    card.height = `${cardH}px`;

    // はがき内コンテンツ（座標はカード基準）
    // 動画のフチ自体をミシン目でクリップする（白フチなし）
    const pad = MM.pad * pxMm;
    const videoW = cardW - 2 * pad;
    const videoH = (videoW * 9) / 16;
    const vb = this.videoBoxEl.style;
    vb.left = `${pad}px`;
    vb.top = `${pad}px`;
    vb.width = `${videoW}px`;
    vb.height = `${videoH}px`;
    vb.clipPath = `path('${stampPath(videoW, videoH, MM.perfR * pxMm, MM.perfStep * pxMm)}')`;

    const capTop = pad + videoH + MM.gap * pxMm;
    const cap = this.captionEl.style;
    cap.left = `${pad}px`;
    cap.top = `${capTop}px`;
    cap.width = `${videoW}px`;
    cap.height = `${cardH - pad - capTop}px`;

    this.titleEl.style.fontSize = `${MM.fontTitle * pxMm}px`;
    this.rootEl.querySelector('.win-meta').style.fontSize = `${MM.fontMeta * pxMm}px`;

    // キャリブレーション用ガイド矩形: 開口170×120（ブリード内側）とはがき148×100
    const ap = this.apertureEl.style;
    const bleed = MM.bleed * pxMm;
    ap.left = `${bleed}px`;
    ap.top = `${bleed}px`;
    ap.width = `${rect.w - 2 * bleed}px`;
    ap.height = `${rect.h - 2 * bleed}px`;
    const pc = this.postcardEl.style;
    pc.left = `${cardX}px`;
    pc.top = `${cardY}px`;
    pc.width = `${cardW}px`;
    pc.height = `${cardH}px`;

  }

  showFrost() {
    this.frostEl.classList.add('active');
  }

  hideFrost() {
    this.frostEl.classList.remove('active');
  }

  // --- キャプション ---

  clearCaption() {
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
    this.titleEl.textContent = '';
    this.locationEl.textContent = '';
    this.timeEl.textContent = '';
  }

  setCaption(data) {
    this.titleEl.textContent = data.title || '';
    this.titleEl.title = data.title || '';
    this.locationEl.textContent = data.locationName || 'Location unknown';
    this.startClock(data.timezone);
  }

  startClock(timezone) {
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
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

    // ガラスが曇り切るのを待ってから旧映像を破棄（曇りの途中は旧映像が透けている）
    this.showFrost();
    await new Promise((r) => setTimeout(r, FROST_MS));
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
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }

    if (!success) {
      this.isSwitching = false;
      setTimeout(() => this.switchNext(), FAIL_RETRY_MS);
      return;
    }

    // intro UIが消えるまで曇ったまま待ち、キャプションを整えてからゆっくり晴らす
    await new Promise((r) => setTimeout(r, POST_LOAD_HOLD_MS));
    this.setCaption(data);
    this.hideFrost();
    this.isSwitching = false;
  }
}
