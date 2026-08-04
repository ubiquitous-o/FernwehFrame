// エントリーポイント：3窓（RÖDALMトリプティク）を初期化して回す。
// 窓ごとに独立したプレイヤーを持ち、毎時 :00 / :20 / :40 にスタガー切替する。
import { loadLayout, windowRects } from './layout.js';
import { FrameWindow } from './frameWindow.js';
import { initCalibration } from './calibration.js';
import { initInput } from './input.js';

// 窓iの毎時切替タイミング（分）
const SWITCH_MINUTES = [0, 20, 40];
// 起動時のロードをずらしてAPIバーストを避ける
const INITIAL_STAGGER_MS = 2500;

let ytApiReady = false;

// --- 3窓のセットアップ ---
const windows = [0, 1, 2].map((i) => {
  const rootEl = document.getElementById(`win-${i}`);
  // 他の窓が再生中/切替中の動画IDを除外リストとして渡す
  const getExcludeIds = () =>
    windows.filter((w) => w && w.index !== i && w.current)
      .map((w) => w.current.videoId);
  // 他の窓の現在の書体も避ける（3枚のはがきが同じ筆跡にならないように）
  const getExcludeFonts = () =>
    windows.filter((w) => w && w.index !== i && w.currentFont)
      .map((w) => w.currentFont);
  return new FrameWindow(i, rootEl, getExcludeIds, getExcludeFonts);
});

const ctx = {
  layout: loadLayout(),
  windows,
  applyAll() {
    windowRects(this.layout).forEach((rect, i) => windows[i].applyRect(rect));
  },
};
ctx.applyAll();

const calibration = initCalibration(ctx);
initInput({ windows, calibration });

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
  setTimeout(() => {
    windows[i].switchNext();
    scheduleSwitch(i);
  }, msUntilMinute(SWITCH_MINUTES[i]));
}

// --- YouTube IFrame API ---
// ESモジュールはdefer扱いなので、コールバック定義後に動的ロードする
window.onYouTubeIframeAPIReady = () => {
  ytApiReady = true;
  windows.forEach((w, i) => {
    setTimeout(() => w.switchNext(), i * INITIAL_STAGGER_MS);
    scheduleSwitch(i);
  });
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

// レイアウトはモニタ(screen)基準の絶対px。ウィンドウリサイズでは何も変えない。
