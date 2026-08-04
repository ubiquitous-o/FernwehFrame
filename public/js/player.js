// YouTube IFrame Player API のラッパー（3窓・スロット汎用版）。
// 窓ごとのスロット要素に新規 YT.Player を作成し、PLAYING になったら resolve。
// 単一player + loadVideoById方式はbot検知に引っかかりやすいため毎回作り直す。

const PLAYBACK_TIMEOUT = 12000; // モバイル/低速回線で正常動画を巻き込まない程度に余裕

// スロット要素に新規 YT.Player を作る。PLAYING に遷移したら player を resolve。
// 失敗・タイムアウト時は内部で破棄してから reject。
export function createPlayer(slotEl, videoId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let player = null;

    const cleanup = () => {
      destroyPlayer(player, slotEl);
      player = null;
    };

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn(`Playback timeout: ${videoId}`);
        cleanup();
        reject(new Error('Playback timeout'));
      }
    }, PLAYBACK_TIMEOUT);

    // プレーヤー用divを再生成（YT.Playerがこのdivをiframeに置換する）
    slotEl.innerHTML = '';
    const target = document.createElement('div');
    slotEl.appendChild(target);

    player = new YT.Player(target, {
      videoId,
      playerVars: {
        autoplay: 1,
        mute: 1,
        controls: 0,
        showinfo: 0,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        loop: 1,
        playlist: videoId,
        enablejsapi: 1,
        origin: location.origin,
        playsinline: 1,
        disablekb: 1,
        cc_load_policy: 0,
        fs: 0,
      },
      events: {
        onReady: (e) => {
          e.target.mute();
          e.target.playVideo();
        },
        onStateChange: (e) => {
          // UNSTARTED=-1, ENDED=0, PLAYING=1, PAUSED=2, BUFFERING=3, CUED=5
          if (e.data === 1 && !settled) {
            settled = true;
            clearTimeout(timeoutId);
            resolve(player);
          }
          // 謎の自動pauseを検出したら即座に再開
          if (e.data === 2) {
            try { e.target.playVideo(); } catch {}
          }
        },
        onError: (e) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            console.warn(`Player error (code ${e.data}): ${videoId}`);
            cleanup();
            reject(new Error(`Player error: ${e.data}`));
          }
        },
      },
    });
  });
}

// playerを破棄してスロットを空に戻す。
export function destroyPlayer(player, slotEl) {
  if (player) {
    try { player.destroy(); } catch {}
  }
  slotEl.innerHTML = '';
}
