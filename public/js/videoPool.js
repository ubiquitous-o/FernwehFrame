// 動画候補プール管理：videos.jsonをロードし、視聴済みを除外、シャッフル、次の動画を返す。
// 3窓共有のプール。excludeIdsで「他の窓が今流している動画」を避ける。
import { guessLocation } from './locations.js';

const WATCHED_KEY = 'ff_watched';
const MAX_WATCHED = 150;
const POOL_REFRESH_INTERVAL = 2 * 60 * 60 * 1000; // 2時間（サーバ更新間隔に合わせる）

let videoPool = [];
let videosLoaded = false;
let lastPoolFetch = 0;

function getWatched() {
  try {
    return JSON.parse(localStorage.getItem(WATCHED_KEY) || '[]');
  } catch { return []; }
}

function addWatched(videoId) {
  const watched = getWatched();
  if (!watched.includes(videoId)) {
    watched.push(videoId);
    while (watched.length > MAX_WATCHED) watched.shift();
    localStorage.setItem(WATCHED_KEY, JSON.stringify(watched));
  }
}

async function loadVideoPool() {
  const res = await fetch('videos.json');
  if (!res.ok) throw new Error(`Failed to load videos.json: ${res.status}`);
  const allVideos = await res.json();

  // 視聴済みを除外
  const watched = new Set(getWatched());
  videoPool = allVideos.filter(v => !watched.has(v.videoId));

  // 全部見終わったらリセットして再シャッフル
  if (videoPool.length === 0) {
    localStorage.removeItem(WATCHED_KEY);
    videoPool = [...allVideos];
  }

  // Fisher-Yates シャッフル
  for (let i = videoPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [videoPool[i], videoPool[j]] = [videoPool[j], videoPool[i]];
  }

  videosLoaded = true;
  lastPoolFetch = Date.now();
}

// 進行中のロードを共有する。複数窓がほぼ同時に切替えると（起動時のスタガー等）
// loadVideoPoolが二重に走り、後勝ちの新品プールに「取り出し済みの動画」が
// 復活して2窓に同じ動画が出うる。1本のPromiseに相乗りさせて防ぐ
let loadPromise = null;
function ensurePoolLoaded() {
  if (!loadPromise) {
    loadPromise = loadVideoPool().finally(() => { loadPromise = null; });
  }
  return loadPromise;
}

export async function fetchNext(excludeIds = []) {
  const poolStale = Date.now() - lastPoolFetch > POOL_REFRESH_INTERVAL;
  if (!videosLoaded || videoPool.length === 0 || poolStale) {
    await ensurePoolLoaded();
  }
  if (videoPool.length === 0) {
    throw new Error('No videos available in videos.json');
  }

  // 他の窓で再生中の動画は避ける（プール全滅時のみ許容）
  const idx = videoPool.findIndex(v => !excludeIds.includes(v.videoId));
  const video = idx >= 0 ? videoPool.splice(idx, 1)[0] : videoPool.shift();

  addWatched(video.videoId);
  // 場所情報が未設定ならランタイムで推測
  if (!video.location) {
    const guess = guessLocation(video.title, video.channel);
    if (guess) {
      video.location = guess.coords;
      video.locationName = guess.name;
    }
  }
  return video;
}
