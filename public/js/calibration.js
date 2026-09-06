// キャリブレーションモード：モニタ上の3窓を物理フレームの開口部へ合わせ込む。
// キー操作で全体（スケール・位置）・窓ごと（位置・サイズ）・はがきの実寸(mm)を調整し、
// localStorageへ保存する。
import {
  saveLayout, resetLayout, centerOrigin,
  RODALM, POSTCARD, apertureMm, BG_BRIGHTNESS, clampCard, cardScale,
  getPxPerMm, setDisplayWidthMm, getDisplayWidthMm,
} from './layout.js';

// キー連打（オートリピート）ごとに書き込まないための保存デバウンス
const SAVE_DEBOUNCE_MS = 300;

// 矢印キー → 移動方向
const MOVES = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function initCalibration(ctx) {
  // ctx: { layout, windows, applyAll() } — layoutは差し替わるのでctx経由で共有
  let active = false;
  let selected = 'all'; // 'all' | 'card' | 0 | 1 | 2
  let saveTimer = null;
  let dirty = false;

  const $readout = document.getElementById('cal-readout');
  const $guides = document.getElementById('cal-guides');
  const $inputRow = document.getElementById('cal-input-row');
  const $input = document.getElementById('cal-input');

  // ガイド凡例はジオメトリ定数と現在のはがきサイズから生成（数値の二重管理を避ける）
  function updateGuides() {
    const ap = apertureMm();
    const card = ctx.layout.card;
    $guides.textContent = [
      'guides:',
      `green    ${RODALM.winW}x${RODALM.winH} render`,
      `cyan     ${ap.w}x${ap.h} aperture`,
      `orange   ${card.w}x${card.h} postcard`,
    ].join('\n');
  }

  function updateSelection() {
    ctx.windows.forEach((w, i) => {
      w.rootEl.classList.toggle('cal-selected', selected === i);
    });
    document.body.classList.toggle('cal-all', selected === 'all');
    document.body.classList.toggle('cal-card', selected === 'card');
  }

  function targetLabel() {
    if (selected === 'all') return 'ALL (frame)';
    if (selected === 'card') return 'POSTCARD (size)';
    return `WINDOW ${selected + 1}`;
  }

  function updateReadout() {
    const L = ctx.layout;
    const card = L.card;
    const isDefault = card.w === POSTCARD.w && card.h === POSTCARD.h;
    const lines = [
      `TARGET: ${targetLabel()}`,
      `scale: ${L.scale.toFixed(3)} px/mm  (frame ${Math.round(RODALM.frameW * L.scale)}x${Math.round(RODALM.frameH * L.scale)}px)`,
      `origin: ${Math.round(L.originX)}, ${Math.round(L.originY)}`,
      `bg brightness: ${L.bg.toFixed(2)}`,
      // はがきの実寸と比率。content = 文字・余白・装飾のスケール（148×100を1.00とする）
      `postcard: ${card.w}x${card.h}mm  ratio ${(card.w / card.h).toFixed(2)}`
        + `  content x${cardScale(card).toFixed(2)}${isDefault ? '  (hagaki)' : ''}`,
    ];
    // モニタ物理幅が設定済みなら窓の物理サイズを表示（実寸確認用）
    const pxPerMm = getPxPerMm();
    if (pxPerMm) {
      const wMm = (RODALM.winW * L.scale) / pxPerMm;
      const hMm = (RODALM.winH * L.scale) / pxPerMm;
      lines.push(`monitor: ${getDisplayWidthMm()}mm wide -> window ${wMm.toFixed(0)}x${hMm.toFixed(0)}mm`);
    } else {
      lines.push(`monitor: not set (press M) -> size is best-fit, not true scale`);
    }
    if (typeof selected === 'number') {
      const a = L.wins[selected];
      lines.push(`adjust: dx ${a.dx} dy ${a.dy} dw ${a.dw} dh ${a.dh}`);
    }
    $readout.textContent = lines.join('\n');
    updateGuides();
  }

  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (dirty) {
      saveLayout(ctx.layout);
      dirty = false;
    }
  }

  function refresh() {
    ctx.applyAll();
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    updateReadout();
  }

  function toggle() {
    active = !active;
    document.body.classList.toggle('calibrating', active);
    if (active) {
      updateSelection();
      updateReadout();
    } else {
      hideMonitorInput();
      flushSave();
    }
  }

  // モニタの表示領域横幅(mm)の入力欄（パネル内インライン。ネイティブprompt()は
  // 額縁の外＝見えない位置に出るため使わない）
  function showMonitorInput() {
    $inputRow.classList.add('visible');
    const current = getDisplayWidthMm();
    $input.value = current ? String(current) : '';
    $input.focus();
    $input.select();
  }

  function hideMonitorInput() {
    $inputRow.classList.remove('visible');
    $input.blur();
  }

  function commitMonitorInput() {
    const mm = parseFloat($input.value);
    if (mm > 100 && mm < 3000) {
      setDisplayWidthMm(mm);
      // 真のpx/mmでスケール再設定＆モニタ中央に再配置
      ctx.layout.scale = getPxPerMm();
      centerOrigin(ctx.layout);
      refresh();
    }
    hideMonitorInput();
  }

  // 入力中のキーは文書側のショートカットに流さない（数字キー等が窓切替を誘発するため）
  $input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commitMonitorInput();
    else if (e.key === 'Escape') hideMonitorInput();
  });

  // はがきの実寸(mm)を変える。範囲外はclampCardが丸める
  function resizeCard(dw, dh) {
    const c = ctx.layout.card;
    ctx.layout.card = clampCard({ w: c.w + dw, h: c.h + dh });
    refresh();
  }

  // 有効中のキー入力を処理。処理したらtrueを返す（input.js側で他のキー処理を抑止）。
  function handleKey(e) {
    if (!active) return false;

    const big = e.shiftKey;
    const step = big ? 10 : 1;
    const L = ctx.layout;

    const move = MOVES[e.key];
    if (move) {
      if (selected === 'all') {
        L.originX += move[0] * step;
        L.originY += move[1] * step;
      } else if (selected === 'card') {
        // ←→で幅、↑↓で高さ（↑=高くする）。単位mm
        resizeCard(move[0] * step, -move[1] * step);
        return true;
      } else {
        L.wins[selected].dx += move[0] * step;
        L.wins[selected].dy += move[1] * step;
      }
      refresh();
      return true;
    }

    switch (e.key) {
      case 'Escape':
      case 'c':
      case 'C':
        toggle();
        return true;
      case '0':
        selected = 'all'; updateSelection(); updateReadout(); return true;
      case '1': case '2': case '3':
        selected = Number(e.key) - 1; updateSelection(); updateReadout(); return true;
      case 'p': case 'P':
        selected = 'card'; updateSelection(); updateReadout(); return true;
      case '-': case '_':
        if (selected === 'all') L.scale *= big ? 0.98 : 0.995;
        else if (selected === 'card') { resizeCard(-step, 0); return true; }
        else L.wins[selected].dw -= step;
        refresh(); return true;
      case '=': case '+':
        if (selected === 'all') L.scale *= big ? 1.02 : 1.005;
        else if (selected === 'card') { resizeCard(step, 0); return true; }
        else L.wins[selected].dw += step;
        refresh(); return true;
      case '[': case '{':
        if (selected === 'card') resizeCard(0, -step);
        else if (selected !== 'all') { L.wins[selected].dh -= step; refresh(); }
        return true;
      case ']': case '}':
        if (selected === 'card') resizeCard(0, step);
        else if (selected !== 'all') { L.wins[selected].dh += step; refresh(); }
        return true;
      case ',': case '<':
      case '.': case '>': {
        // 窓の生成り背景の明るさ（全窓共通。はがきの紙は変えない）
        const dir = (e.key === ',' || e.key === '<') ? -1 : 1;
        const d = big ? BG_BRIGHTNESS.bigStep : BG_BRIGHTNESS.step;
        L.bg = Math.min(BG_BRIGHTNESS.max,
          Math.max(BG_BRIGHTNESS.min, +(L.bg + dir * d).toFixed(2)));
        refresh();
        return true;
      }
      case 'm': case 'M':
        showMonitorInput();
        return true;
      case 'r': case 'R':
        ctx.layout = resetLayout();
        dirty = false;
        ctx.applyAll();
        updateReadout();
        return true;
      default:
        return false;
    }
  }

  return {
    get active() { return active; },
    toggle,
    handleKey,
  };
}
