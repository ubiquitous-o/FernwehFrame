// エントリーポイント：3窓（RÖDALMトリプティク）を初期化して回す。
// 窓のDOMは#window-templateからここで生成する（マークアップの単一ソース）。
// 窓ごとに独立したプレイヤーを持ち、毎時 :00 / :20 / :40 にスタガー切替する。
import { loadLayout, windowRects, applyBgBrightness } from './layout.js';
import { FrameWindow, FONTS } from './frameWindow.js';
import { initCalibration } from './calibration.js';
import { initInput } from './input.js';

// 窓iの毎時切替タイミング（分）
const SWITCH_MINUTES = [0, 20, 40];
// 起動時のロードをずらしてAPIバーストを避ける
const INITIAL_STAGGER_MS = 2500;
// 手動の全窓切替のずらし幅
const SWITCH_ALL_STAGGER_MS = 400;
// 定時切替のこの時間前に次の動画を裏スロットへプリロードする。
// 常時プリロード（6ストリーム同時）は負荷とbot検知リスクが高いため直前だけ
const PRELOAD_LEAD_MS = 60 * 1000;

let ytApiReady = false;

// --- キャプション用フォントのロード ---
// FONTS（frameWindow.js）が唯一のソース。ここでcss2 URLを組み立てて注入する。
const fontsLink = document.createElement('link');
fontsLink.rel = 'stylesheet';
fontsLink.href = 'https://fonts.googleapis.com/css2?'
  + FONTS.map((f) => `family=${f.replaceAll(' ', '+')}`).join('&')
  // lettersデザインの地名マスク専用書体（キャプションのローテには入れない）。
  // designs.jsのLETTER_FONTSと対で管理する
  + '&family=Climate+Crisis&family=Oi&family=Ultra'
  + '&display=swap';
document.head.appendChild(fontsLink);

// lettersデザインは初回表示前にgetBBoxで実測するため、書体を先にロードさせておく
fontsLink.addEventListener('load', () => {
  ['Climate Crisis', 'Oi', 'Ultra']
    .forEach((f) => document.fonts.load(`100px '${f}'`));
});

// --- 3窓のセットアップ ---
const $stage = document.getElementById('stage');
const $template = document.getElementById('window-template');

const windows = [0, 1, 2].map((i) => {
  const rootEl = $template.content.firstElementChild.cloneNode(true);
  rootEl.id = `win-${i}`;
  rootEl.querySelector('.win-label').textContent = String(i + 1);
  $stage.appendChild(rootEl);

  const others = () => windows.filter((w) => w.index !== i);
  // 他の窓が再生中/プリロード中の動画・書体・デザインは避ける
  const getExcludeIds = () => others()
    .flatMap((w) => [w.current?.videoId, w.preload?.data.videoId])
    .filter(Boolean);
  const getExcludeFonts = () => others().map((w) => w.currentFont).filter(Boolean);
  const getExcludeDesigns = () => others().map((w) => w.design);
  return new FrameWindow(i, rootEl, getExcludeIds, getExcludeFonts, getExcludeDesigns);
});

const ctx = {
  layout: loadLayout(),
  windows,
  applyAll() {
    windowRects(this.layout).forEach((rect, i) => windows[i].applyRect(rect));
    applyBgBrightness(this.layout.bg);
  },
};
ctx.applyAll();

// 全窓切替（同時にAPIを叩かないよう窓ごとにずらす）
function switchAll(staggerMs = SWITCH_ALL_STAGGER_MS) {
  windows.forEach((w, i) => setTimeout(() => w.switchNext(), i * staggerMs));
}

const calibration = initCalibration(ctx);
initInput({ windows, calibration, switchAll });

// 起動直後から全窓曇らせておく
windows.forEach((w) => w.showFrost());

// --- 毎時スタガー切替 ---
function msUntilMinute(minute) {
  const now = new Date();
  const target = new Date(now);
  target.setMinutes(minute, 0, 0);
  if (target <= now) target.setHours(target.getHours() + 1);
  return target - now;
}

function scheduleSwitch(i) {
  const ms = msUntilMinute(SWITCH_MINUTES[i]);
  // 切替の少し前に裏スロットへプリロード（切替時はswapだけで曇り時間が最短になる）
  if (ms > PRELOAD_LEAD_MS) {
    setTimeout(() => windows[i].preloadNext(), ms - PRELOAD_LEAD_MS);
  }
  setTimeout(() => {
    windows[i].switchNext();
    scheduleSwitch(i);
  }, ms);
}

// --- YouTube IFrame API ---
// ESモジュールはdefer扱いなので、コールバック定義後に動的ロードする
window.onYouTubeIframeAPIReady = () => {
  ytApiReady = true;
  switchAll(INITIAL_STAGGER_MS);
  windows.forEach((_, i) => scheduleSwitch(i));
};

const ytApiScript = document.createElement('script');
ytApiScript.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(ytApiScript);

// YT IFrame APIロード失敗時のフォールバック
setTimeout(() => {
  if (!ytApiReady) {
    console.error('YouTube IFrame API failed to load. Reloading...');
    location.reload();
  }
}, 30000);

// --- 毎日の自動リロード（キオスク健全化） ---
// YTプレイヤーを何日も生かし続けるとメモリが緩むため、1日1回
// 深夜にページごと再起動して初期状態に戻す。レイアウトはlocalStorageに
// 保存されているので、リロード後も物理位置合わせは保たれる。
// Fキー（JS Fullscreen API）のフルスクリーン中はリロードで解除され、
// ユーザー操作なしでは復帰できないため、スキップして翌日に繰り越す。
// キオスク起動（--kiosk）やF11・OSのフルスクリーンはウィンドウレベルなので
// fullscreenElementはnullのまま＝通常どおりリロードされる
const DAILY_RELOAD_HOUR = 4;
function msUntilDailyReload() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(DAILY_RELOAD_HOUR, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}
function scheduleDailyReload() {
  setTimeout(() => {
    if (document.fullscreenElement) {
      console.log('Daily reload skipped (JS fullscreen active)');
      scheduleDailyReload();
      return;
    }
    location.reload();
  }, msUntilDailyReload());
}
scheduleDailyReload();

// --- 焼き付き防止のピクセルシフト ---
// レイアウト全体を周期的に±数pxずらし、静止要素（はがきの紙面の縁・ミシン目・
// 消印など）のエッジが同じ画素に居座り続けないようにする。
// 描画領域は額縁の開口より四辺5mm（≈27px）大きいブリードを持つため、
// この振幅では開口からのはみ出しや黒見えは起きない。
// 30秒かけて滑らせる（0.1px/s）ので動きは視認できない。
// キャリブレーション中は位置合わせの邪魔になるためシフトを解除する
const BURNIN_SHIFT_PX = 3;
const BURNIN_INTERVAL_MS = 10 * 60 * 1000;
$stage.style.transition = 'transform 30s linear';
setInterval(() => {
  if (document.body.classList.contains('calibrating')) {
    $stage.style.transform = '';
    return;
  }
  const dx = Math.round(Math.random() * 2 * BURNIN_SHIFT_PX - BURNIN_SHIFT_PX);
  const dy = Math.round(Math.random() * 2 * BURNIN_SHIFT_PX - BURNIN_SHIFT_PX);
  $stage.style.transform = `translate(${dx}px, ${dy}px)`;
}, BURNIN_INTERVAL_MS);

// レイアウトはモニタ(screen)基準の絶対px。ウィンドウリサイズでは何も変えない。
