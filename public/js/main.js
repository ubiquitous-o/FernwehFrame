// エントリーポイント：3窓（RÖDALMトリプティク）を初期化して回す。
// 窓のDOMは#window-templateからここで生成する（マークアップの単一ソース）。
// 窓ごとに独立したプレイヤーを持ち、毎時 :00 / :20 / :40 にスタガー切替する。
import { loadLayout, windowRects } from './layout.js';
import { FrameWindow, FONTS } from './frameWindow.js';
import { initCalibration } from './calibration.js';
import { initInput } from './input.js';

// 窓iの毎時切替タイミング（分）
const SWITCH_MINUTES = [0, 20, 40];
// 起動時のロードをずらしてAPIバーストを避ける
const INITIAL_STAGGER_MS = 2500;
// 手動の全窓切替のずらし幅
const SWITCH_ALL_STAGGER_MS = 400;

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
  // 他の窓が再生中/切替中の動画・書体・デザインは避ける
  const getExcludeIds = () => others().map((w) => w.current?.videoId).filter(Boolean);
  const getExcludeFonts = () => others().map((w) => w.currentFont).filter(Boolean);
  const getExcludeDesigns = () => others().map((w) => w.design);
  return new FrameWindow(i, rootEl, getExcludeIds, getExcludeFonts, getExcludeDesigns);
});

const ctx = {
  layout: loadLayout(),
  windows,
  applyAll() {
    windowRects(this.layout).forEach((rect, i) => windows[i].applyRect(rect));
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
  setTimeout(() => {
    windows[i].switchNext();
    scheduleSwitch(i);
  }, msUntilMinute(SWITCH_MINUTES[i]));
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
// 保存されているので、リロード後も物理位置合わせは保たれる
const DAILY_RELOAD_HOUR = 4;
function msUntilDailyReload() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(DAILY_RELOAD_HOUR, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}
setTimeout(() => location.reload(), msUntilDailyReload());

// レイアウトはモニタ(screen)基準の絶対px。ウィンドウリサイズでは何も変えない。
