// マウス・キーボード・クリック入力。
// 通常時: 窓クリック=その窓を切替 / 1-3=窓指定切替 / Space,N=全窓切替 / F=フルスクリーン / C=キャリブレーション

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

export function initInput({ windows, calibration, switchAll }) {
  let mouseTimer = null;

  document.addEventListener('mousemove', () => {
    document.body.classList.add('mouse-active');
    clearTimeout(mouseTimer);
    mouseTimer = setTimeout(() => {
      document.body.classList.remove('mouse-active');
    }, 3000);
  });

  // 窓クリックでその窓だけ切替
  windows.forEach((w) => {
    w.rootEl.addEventListener('click', () => {
      if (calibration.active) return;
      w.switchNext();
    });
  });

  document.addEventListener('keydown', (e) => {
    // キャリブレーション中はそちらを優先
    if (calibration.handleKey(e)) {
      e.preventDefault();
      return;
    }

    switch (e.key) {
      case 'c': case 'C':
        calibration.toggle();
        break;
      case '1': case '2': case '3':
        windows[Number(e.key) - 1].switchNext();
        break;
      case ' ': case 'n': case 'N': case 'ArrowRight':
        switchAll();
        break;
      case 'f': case 'F': case 'F11':
        e.preventDefault();
        toggleFullscreen();
        break;
    }
  });
}
