// キャリブレーションモード：モニタ上の3窓を物理フレームの開口部へ合わせ込む。
// キー操作で全体（スケール・位置）と窓ごと（位置・サイズ・横パン）を調整し、
// 変更のたびlocalStorageへ保存する。
import {
  saveLayout, resetLayout, RODALM, windowRect,
  getPxPerMm, setDisplayWidthMm, getDisplayWidthMm,
} from './layout.js';

export function initCalibration(ctx) {
  // ctx: { layout, windows, applyAll() } — layoutは差し替わるのでctx経由で共有
  let active = false;
  let selected = 'all'; // 'all' | 0 | 1 | 2

  const $help = document.getElementById('cal-help');
  const $readout = document.getElementById('cal-readout');
  const $inputRow = document.getElementById('cal-input-row');
  const $input = document.getElementById('cal-input');

  // 額縁の外は物理的に見えないため、ヘルプパネルは窓2の矩形内に重ねる
  function positionHelp() {
    const rect = windowRect(ctx.layout, 1);
    $help.style.left = `${rect.x + 6}px`;
    $help.style.top = `${rect.y + 6}px`;
    $help.style.maxWidth = `${rect.w - 12}px`;
    $help.style.maxHeight = `${rect.h - 12}px`;
  }

  function updateSelection() {
    ctx.windows.forEach((w, i) => {
      w.rootEl.classList.toggle('cal-selected', selected === i);
    });
    document.body.classList.toggle('cal-all', selected === 'all');
  }

  function updateReadout() {
    const L = ctx.layout;
    const lines = [
      `TARGET: ${selected === 'all' ? 'ALL (frame)' : `WINDOW ${selected + 1}`}`,
      `scale: ${L.scale.toFixed(3)} px/mm  (frame ${Math.round(RODALM.frameW * L.scale)}x${Math.round(RODALM.frameH * L.scale)}px)`,
      `origin: ${Math.round(L.originX)}, ${Math.round(L.originY)}`,
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
    if (selected !== 'all') {
      const a = L.wins[selected];
      lines.push(`adjust: dx ${a.dx} dy ${a.dy} dw ${a.dw} dh ${a.dh}`);
    }
    $readout.textContent = lines.join('\n');
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
      const L = ctx.layout;
      L.scale = getPxPerMm();
      L.originX = (screen.width - RODALM.frameW * L.scale) / 2;
      L.originY = (screen.height - RODALM.frameH * L.scale) / 2;
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

  function refresh() {
    ctx.applyAll();
    saveLayout(ctx.layout);
    updateReadout();
    positionHelp();
  }

  function toggle() {
    active = !active;
    document.body.classList.toggle('calibrating', active);
    $help.classList.toggle('visible', active);
    if (active) {
      updateSelection();
      updateReadout();
      positionHelp();
    } else {
      hideMonitorInput();
    }
  }

  // 有効中のキー入力を処理。処理したらtrueを返す（input.js側で他のキー処理を抑止）。
  function handleKey(e) {
    if (!active) return false;

    const big = e.shiftKey;
    const step = big ? 10 : 1;
    const L = ctx.layout;

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
      case 'ArrowLeft':
        if (selected === 'all') L.originX -= step; else L.wins[selected].dx -= step;
        refresh(); return true;
      case 'ArrowRight':
        if (selected === 'all') L.originX += step; else L.wins[selected].dx += step;
        refresh(); return true;
      case 'ArrowUp':
        if (selected === 'all') L.originY -= step; else L.wins[selected].dy -= step;
        refresh(); return true;
      case 'ArrowDown':
        if (selected === 'all') L.originY += step; else L.wins[selected].dy += step;
        refresh(); return true;
      case '-': case '_':
        if (selected === 'all') L.scale *= big ? 0.98 : 0.995;
        else L.wins[selected].dw -= step;
        refresh(); return true;
      case '=': case '+':
        if (selected === 'all') L.scale *= big ? 1.02 : 1.005;
        else L.wins[selected].dw += step;
        refresh(); return true;
      case '[': case '{':
        if (selected !== 'all') { L.wins[selected].dh -= step; refresh(); }
        return true;
      case ']': case '}':
        if (selected !== 'all') { L.wins[selected].dh += step; refresh(); }
        return true;
      case 'm': case 'M':
        showMonitorInput();
        return true;
      case 'r': case 'R':
        ctx.layout = resetLayout();
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
