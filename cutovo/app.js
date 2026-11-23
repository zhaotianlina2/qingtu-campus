/* ============================================================
 * Cutovo · 赛博剪纸 - 核心逻辑
 * ============================================================ */
(() => {
  'use strict';

  // ============ DOM 引用 ============
  const $ = (s, ctx = document) => ctx.querySelector(s);
  const $$ = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

  const canvasStack   = $('#canvasStack');
  const bgCanvas      = $('#bgCanvas');
  const refCanvas     = $('#refCanvas');
  const drawCanvas    = $('#drawCanvas');
  const bgCtx         = bgCanvas.getContext('2d');
  const refCtx        = refCanvas.getContext('2d');
  const drawCtx       = drawCanvas.getContext('2d');
  const editCanvas = document.createElement('canvas');
  const editCtx = editCanvas.getContext('2d');
  const canvasWrap    = $('#canvasWrap');
  const onboarding    = $('#onboarding');

  // ============ 状态 ============
  const state = {
    w: 0, h: 0,                 // 画布逻辑尺寸（CSS像素）
    dpr: Math.max(1, Math.min(3, window.devicePixelRatio || 1)),
    tool: 'brush',              // brush / eraser / picker
    brushSize: 6,
    brushColor: '#d4a5a5',
    smooth: 0.2,                // 平滑（精细0-1平滑）
    drawing: false,
    lastX: 0, lastY: 0,
    points: [],

    layers: [],                 // {id, name, visible, opacity, dataURL, rotation, flipH, flipV}
    activeLayerId: null,
    bgImage: null,              // 背景自定义图
    bgColor: '#fdf6f2',
    bgGradient: null,
    bgTexture: 'plain',         // plain / paper / grid / dot / stripe

    fillMode: 'solid',          // solid / paper / gradient / outline
    gradient: ['#e8b4b8', '#d88a95'],

    undoStack: [],
    redoStack: [],
    maxHistory: 50,

    refImage: null,             // 参考图
  };

  // ============ 工具函数 ============
  const uid = () => 'L' + Math.random().toString(36).slice(2, 9);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hexToRgba = (hex, a = 1) => {
    const h = hex.replace('#','');
    const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${bigint>>16}, ${(bigint>>8)&255}, ${bigint&255}, ${a})`;
  };

  // ============ 画布初始化 / 响应式 ============
  function setupCanvas() {
    const rect = canvasWrap.getBoundingClientRect();
    // 使用 2 的倍数以便导出清晰
    state.w = Math.round(rect.width);
    state.h = Math.round(rect.height);

    for (const c of [bgCanvas, refCanvas, drawCanvas]) {
      c.width = state.w * state.dpr;
      c.height = state.h * state.dpr;
      c.style.width = state.w + 'px';
      c.style.height = state.h + 'px';
      const ctx = c.getContext('2d');
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }
    editCanvas.width = state.w * state.dpr; editCanvas.height = state.h * state.dpr;
    editCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    editCtx.imageSmoothingEnabled = true; editCtx.imageSmoothingQuality = 'high';
    redrawAll();
  }

  function redrawAll() {
    drawBackground();
    drawReference();
    drawActiveLayer();
  }

  function drawBackground() {
    const { w, h } = state;
    bgCtx.clearRect(0, 0, w, h);

    // 填充底色或渐变
    if (state.bgGradient) {
      const g = bgCtx.createLinearGradient(0, 0, w, h);
      const col = parseGradientCSS(state.bgGradient);
      col.forEach((c, i) => g.addColorStop(i / (col.length - 1), c));
      bgCtx.fillStyle = g;
    } else {
      bgCtx.fillStyle = state.bgColor;
    }
    bgCtx.fillRect(0, 0, w, h);

    // 纹理
    drawTextureOnBg();

    // 自定义背景图
    if (state.bgImage) {
      bgCtx.globalAlpha = 1;
      fitCover(bgCtx, state.bgImage, 0, 0, w, h);
    }
  }

  function parseGradientCSS(css) {
    // 简易解析 linear-gradient(135deg,#a,#b)
    const m = css.match(/linear-gradient\([^,]+,(.+)\)/);
    if (!m) return ['#fff', '#fff'];
    const parts = m[1].split(',').map(s => s.trim());
    return parts;
  }

  function drawTextureOnBg() {
    const { w, h } = state;
    const t = state.bgTexture;
    if (t === 'plain') return;

    bgCtx.save();
    if (t === 'paper') {
      // 噪点纸张纹理
      const imgData = bgCtx.createImageData(w, h);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const n = (Math.random() - 0.5) * 18;
        data[i]   = clamp(250 + n, 0, 255);
        data[i+1] = clamp(243 + n, 0, 255);
        data[i+2] = clamp(236 + n, 0, 255);
        data[i+3] = 26;
      }
      bgCtx.putImageData(imgData, 0, 0);
    } else if (t === 'grid') {
      bgCtx.strokeStyle = 'rgba(180,140,110,0.15)';
      bgCtx.lineWidth = 1;
      const s = 18;
      for (let x = 0; x <= w; x += s) {
        bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, h); bgCtx.stroke();
      }
      for (let y = 0; y <= h; y += s) {
        bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(w, y); bgCtx.stroke();
      }
    } else if (t === 'dot') {
      bgCtx.fillStyle = 'rgba(180,140,110,0.22)';
      const s = 12;
      for (let x = s/2; x <= w; x += s) {
        for (let y = s/2; y <= h; y += s) {
          bgCtx.beginPath(); bgCtx.arc(x, y, 1.3, 0, Math.PI*2); bgCtx.fill();
        }
      }
    } else if (t === 'stripe') {
      bgCtx.save();
      bgCtx.fillStyle = 'rgba(180,140,110,0.08)';
      const stripeW = 16, rep = 12;
      for (let x = -h; x < w + h; x += rep) {
        bgCtx.save();
        bgCtx.translate(x, 0);
        bgCtx.rotate(Math.PI/4);
        bgCtx.fillRect(0, -h, stripeW, h*3);
        bgCtx.restore();
      }
      bgCtx.restore();
    }
    bgCtx.restore();
  }

  function drawReference() {
    refCtx.clearRect(0, 0, state.w, state.h);
    if (state.refImage) {
      refCtx.globalAlpha = 0.7;
      fitContain(refCtx, state.refImage, 0, 0, state.w, state.h);
      refCtx.globalAlpha = 1;
    }
  }

  function fitContain(ctx, img, x, y, w, h) {
    const r = Math.min(w / img.width, h / img.height);
    const dw = img.width * r, dh = img.height * r;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function fitCover(ctx, img, x, y, w, h) {
    const r = Math.max(w / img.width, h / img.height);
    const dw = img.width * r, dh = img.height * r;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  // ============ 图层 ============
  function newLayer(name) {
    const layer = {
      id: uid(),
      name: name || `图层 ${state.layers.length + 1}`,
      visible: true,
      opacity: 1,
      rotation: 0,
      flipH: false,
      flipV: false,
      dataURL: null,
    };
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    return layer;
  }

  function getActiveLayer() {
    return state.layers.find(l => l.id === state.activeLayerId);
  }

  function renderLayerData(layer, ontoCtx, clearFirst = true) {
    // 把 layer.dataURL 画到指定 ctx（考虑翻转/旋转/透明度）
    const { w, h } = state;
    if (clearFirst) ontoCtx.clearRect(0, 0, w, h);
    if (!layer.dataURL) return;
    return new Promise((res) => {
      const img = new Image();
      img.onerror = () => res();
      img.onload = () => {
        ontoCtx.save();
        ontoCtx.globalAlpha = layer.opacity;
        ontoCtx.translate(w/2, h/2);
        ontoCtx.rotate(layer.rotation * Math.PI / 180);
        ontoCtx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
        ontoCtx.drawImage(img, -w/2, -h/2, w, h);
        ontoCtx.restore();
        res();
      };
      img.src = layer.dataURL;
    });
  }

  function drawActiveLayer() {
    drawCtx.clearRect(0, 0, state.w, state.h);
    const drawLayers = async () => {
      for (const l of state.layers) {
        if (!l.visible || !l.dataURL) continue;
        await renderLayerData(l, drawCtx, false);
      }
    };
    drawLayers().then(() => {
      const active = getActiveLayer();
      if (state.drawing && active && active.visible) {
        drawCtx.save(); drawCtx.globalAlpha = active.opacity;
        drawCtx.translate(state.w/2, state.h/2);
        drawCtx.rotate(active.rotation * Math.PI / 180);
        drawCtx.scale(active.flipH ? -1 : 1, active.flipV ? -1 : 1);
        drawCtx.drawImage(editCanvas, -state.w/2, -state.h/2, state.w, state.h); drawCtx.restore();
      }
    });
    if (!state.drawing) loadActiveLayerForEdit();
  }

  function loadActiveLayerForEdit() {
    editCtx.clearRect(0, 0, state.w, state.h);
    const layer = getActiveLayer();
    if (!layer || !layer.dataURL) return;
    const img = new Image();
    img.onload = () => {
      if (getActiveLayer() !== layer) return;
      editCtx.drawImage(img, 0, 0, state.w, state.h);
    };
    img.src = layer.dataURL;
  }

  function snapshotCurrentDrawToActiveLayer() { saveActiveLayerFromCanvas(); }

  function refreshLayerListUI() {
    const host = $('#layerList');
    host.innerHTML = '';
    // 反向显示：顶层在前
    [...state.layers].reverse().forEach(l => {
      const item = document.createElement('div');
      item.className = 'layer-item' + (l.id === state.activeLayerId ? ' active' : '');
      item.dataset.id = l.id;

      const thumb = document.createElement('div');
      thumb.className = 'layer-thumb';
      const tc = document.createElement('canvas');
      tc.width = 72; tc.height = 72;
      const tctx = tc.getContext('2d');
      if (l.dataURL) {
        const img = new Image();
        img.onload = () => {
          tctx.drawImage(img, 0, 0, 72, 72);
        };
        img.src = l.dataURL;
      }
      thumb.appendChild(tc);

      const info = document.createElement('div');
      info.className = 'layer-info';
      const nm = document.createElement('div');
      nm.className = 'layer-name';
      nm.textContent = l.name;
      const mt = document.createElement('div');
      mt.className = 'layer-meta';
      mt.textContent = `${Math.round(l.opacity * 100)}% · ${l.visible ? '可见' : '隐藏'}`;
      info.appendChild(nm); info.appendChild(mt);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '4px';

      const eye = document.createElement('button');
      eye.className = 'layer-btn eye' + (l.visible ? '' : ' off');
      eye.innerHTML = l.visible ? '👁' : '✕';
      eye.title = '显示/隐藏';
      eye.onclick = (e) => { e.stopPropagation(); l.visible = !l.visible; refreshLayerListUI(); drawActiveLayer(); };

      const del = document.createElement('button');
      del.className = 'layer-btn';
      del.innerHTML = '🗑';
      del.title = '删除';
      del.onclick = (e) => {
        e.stopPropagation();
        if (state.layers.length <= 1) return;
        const idx = state.layers.findIndex(x => x.id === l.id);
        state.layers.splice(idx, 1);
        if (state.activeLayerId === l.id) state.activeLayerId = state.layers[0].id;
        refreshLayerListUI();
        pushUndo();
        drawActiveLayer();
      };
      actions.appendChild(eye); actions.appendChild(del);

      item.appendChild(thumb); item.appendChild(info); item.appendChild(actions);
      item.onclick = () => { state.activeLayerId = l.id; refreshLayerListUI(); drawActiveLayer(); updateTransformPanel(); };
      host.appendChild(item);
    });
  }

  function updateTransformPanel() {
    const l = getActiveLayer();
    if (!l) return;
    $('#opacityRange').value = Math.round(l.opacity * 100);
  }

  // ============ 撤销重做 ============
  function pushUndo() {
    const snap = JSON.stringify(state.layers.map(l => ({ ...l })));
    state.undoStack.push(snap);
    if (state.undoStack.length > state.maxHistory) state.undoStack.shift();
    state.redoStack.length = 0;
    updateUndoButtons();
  }

  function restoreLayersFromJSON(json) {
    const arr = JSON.parse(json);
    state.layers = arr;
    if (!state.layers.find(l => l.id === state.activeLayerId) && state.layers[0]) {
      state.activeLayerId = state.layers[0].id;
    }
  }

  function undo() {
    if (!state.undoStack.length) return;
    const cur = JSON.stringify(state.layers.map(l => ({ ...l })));
    state.redoStack.push(cur);
    const prev = state.undoStack.pop();
    restoreLayersFromJSON(prev);
    refreshLayerListUI();
    drawActiveLayer();
    updateUndoButtons();
  }
  function redo() {
    if (!state.redoStack.length) return;
    const cur = JSON.stringify(state.layers.map(l => ({ ...l })));
    state.undoStack.push(cur);
    const nx = state.redoStack.pop();
    restoreLayersFromJSON(nx);
    refreshLayerListUI();
    drawActiveLayer();
    updateUndoButtons();
  }
  function updateUndoButtons() {
    $('#toolUndo').disabled = state.undoStack.length === 0;
    $('#toolRedo').disabled = state.redoStack.length === 0;
  }

  // ============ 绘制 ============
  function eventPos(e) {
    const rect = drawCanvas.getBoundingClientRect();
    const cx = e.clientX != null ? e.clientX : (e.touches && e.touches[0].clientX);
    const cy = e.clientY != null ? e.clientY : (e.touches && e.touches[0].clientY);
    return { x: cx - rect.left, y: cy - rect.top };
  }

  function startStroke(e) {
    e.preventDefault();
    if (state.tool === 'picker') {
      const p = eventPos(e);
      pickColorAt(p.x, p.y);
      return;
    }
    const p = eventPos(e);
    state.drawing = true;
    state.points = [{ x: p.x, y: p.y }];
    state.lastX = p.x; state.lastY = p.y;
    pushUndo();

    // 确保有活动图层
    if (!getActiveLayer()) {
      newLayer('图层 1');
      refreshLayerListUI();
    }
  }

  function moveStroke(e) {
    if (state.tool === 'picker' && e.buttons) {
      const p = eventPos(e);
      pickColorAt(p.x, p.y);
      return;
    }
    if (!state.drawing) return;
    e.preventDefault();
    const p = eventPos(e);
    // 线性插值（精细-平滑）
    const steps = Math.max(1, Math.round((1 - state.smooth) * 10));
    const dx = (p.x - state.lastX) / steps;
    const dy = (p.y - state.lastY) / steps;
    for (let i = 1; i <= steps; i++) {
      const x = state.lastX + dx * i;
      const y = state.lastY + dy * i;
      drawDot(x, y);
    }
    state.lastX = p.x; state.lastY = p.y;
  }

  function endStroke(e) {
    if (!state.drawing) return;
    e && e.preventDefault();
    state.drawing = false;
    // 平滑后处理：可选做轻度模糊平滑（基于 smooth 值）
    if (state.smooth > 0.4) {
      smoothActiveLayer();
    }
    saveActiveLayerFromCanvas();
    drawActiveLayer();
    updateUndoButtons();
  }

  function drawDot(x, y) {
    const l = getActiveLayer();
    if (!l) return;
    editCtx.save();
    editCtx.globalCompositeOperation = state.tool === 'eraser' ? 'destination-out' : 'source-over';
    editCtx.globalAlpha = 1;
    editCtx.fillStyle = state.brushColor;
    // 为了避免把其他图层也擦掉，eraser 只在激活层自己的画布上操作：
    // 我们采取策略：drawCanvas 仅重绘当前激活层（不带其它图层）进行绘制
    // 绘制结束再 saveActiveLayerFromCanvas
    editCtx.beginPath();
    editCtx.arc(x, y, state.brushSize / 2, 0, Math.PI * 2);
    editCtx.fill();
    editCtx.restore();
    drawActiveLayer();
  }

  // 把当前 drawCanvas 内容（仅激活层的内容）保存回 layer.dataURL
  // 为了避免把其他图层"固化"到激活层：绘制开始前我们需要确保 drawCanvas 仅包含激活层
  // 在 startStroke 中 pushUndo 之后，drawActiveLayer（包含全部图层）被显示，
  // 我们现在要把"激活层单独提取"到临时画布绘制，这会很复杂。
  // 简化策略：我们把 drawCanvas 当"全部合成后"来绘制，
  // 在保存时，把结果（所有可见图层合成）保存为激活层，其余图层清空。
  // 对于简单场景够用，且符合用户直观。
  function saveActiveLayerFromCanvas() {
    const l = getActiveLayer();
    if (!l) return;
    l.dataURL = editCanvas.toDataURL('image/png');
  }

  function smoothActiveLayer() {
    const l = getActiveLayer();
    if (!l || !l.dataURL) return;
    const radius = Math.max(0.5, state.smooth * 2.5);
    // 用离屏画布配合 filter: blur + 轻度
    const off = document.createElement('canvas');
    off.width = state.w; off.height = state.h;
    const octx = off.getContext('2d');
    const img = new Image();
    img.onload = () => {
      octx.filter = `blur(${radius}px)`;
      octx.drawImage(img, 0, 0);
      // 再把 canvas 画回到 drawCanvas 激活区
      editCtx.clearRect(0, 0, state.w, state.h);
      editCtx.drawImage(off, 0, 0);
      l.dataURL = editCanvas.toDataURL('image/png');
      drawActiveLayer();
    };
    img.src = l.dataURL;
  }

  // ============ 取色 ============
  function pickColorAt(x, y) {
    // 从 drawCanvas + refCanvas 合成中取样
    const sx = Math.round(x * state.dpr);
    const sy = Math.round(y * state.dpr);
    // 先合成
    const tmp = document.createElement('canvas');
    tmp.width = state.w * state.dpr; tmp.height = state.h * state.dpr;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(drawCanvas, 0, 0);
    tctx.drawImage(refCanvas, 0, 0);
    const p = tctx.getImageData(sx, sy, 1, 1).data;
    const r = p[0].toString(16).padStart(2, '0');
    const g = p[1].toString(16).padStart(2, '0');
    const b = p[2].toString(16).padStart(2, '0');
    const hex = '#' + r + g + b;
    state.brushColor = hex;
    $('#colorPicker').value = hex;
    // 小提示
    flashPickerHint(hex);
  }
  function flashPickerHint(hex) {
    const t = document.createElement('div');
    t.textContent = hex.toUpperCase();
    Object.assign(t.style, {
      position: 'fixed', zIndex: 9999, padding: '6px 12px', borderRadius: '10px',
      background: 'rgba(42,30,26,0.9)', color: '#fff', fontSize: '13px', fontWeight: 600,
      top: '80px', left: '50%', transform: 'translateX(-50%)',
      boxShadow: '0 6px 20px rgba(0,0,0,0.2)', opacity: 0, transition: 'opacity 0.2s'
    });
    document.body.appendChild(t);
    requestAnimationFrame(() => t.style.opacity = 1);
    setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.remove(), 250); }, 1100);
  }

  // ============ Toast 轻提示 ============
  let toastTimer = null;
  function showToast(msg, type = 'info', duration = 2000) {
    let el = document.getElementById('__toast');
    if (!el) {
      el = document.createElement('div');
      el.id = '__toast';
      Object.assign(el.style, {
        position: 'fixed', zIndex: 99999, left: '50%', top: '88px',
        transform: 'translateX(-50%) translateY(-10px)',
        padding: '10px 18px', borderRadius: '12px', fontSize: '13px',
        fontWeight: '500', letterSpacing: '0.2px',
        color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        transition: 'opacity .25s, transform .25s', opacity: 0,
        pointerEvents: 'none', maxWidth: '80vw', textAlign: 'center'
      });
      document.body.appendChild(el);
    }
    const bg = { info: 'rgba(60,45,40,0.88)', ok: 'rgba(90,150,115,0.95)', err: 'rgba(200,85,90,0.95)' }[type] || 'rgba(60,45,40,0.88)';
    el.style.background = bg;
    el.textContent = msg;
    el.offsetHeight; // reflow
    el.style.opacity = 1;
    el.style.transform = 'translateX(-50%) translateY(0)';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.opacity = 0;
      el.style.transform = 'translateX(-50%) translateY(-10px)';
    }, duration);
  }

  // ============ 照片上传 ============
  function handleFileUpload(file) {
    if (!file) { showToast('未选择任何文件', 'err'); return; }
    if (!file.type.startsWith('image/')) { showToast('请选择图片格式', 'err'); return; }
    if (file.size > 20 * 1024 * 1024) { showToast('图片过大（请 < 20MB）', 'err'); return; }
    const reader = new FileReader();
    reader.onerror = () => showToast('读取文件失败', 'err');
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        state.refImage = img;
        onboarding.classList.add('hidden');
        if (state.layers.length === 0) {
          newLayer('剪纸 1');
          refreshLayerListUI();
        }
        redrawAll();
        pushUndo();
        showToast('底图上传成功，开始描摹吧 ✂️', 'ok', 2200);
      };
      img.onerror = () => showToast('图片解码失败，请换一张', 'err');
      img.src = e.target.result;
    };
    try { reader.readAsDataURL(file); }
    catch (err) { showToast('上传失败: ' + (err.message || err), 'err'); }
  }

  function handleBgFileUpload(file) {
    if (!file) { showToast('未选择任何文件', 'err'); return; }
    if (!file.type.startsWith('image/')) { showToast('请选择图片格式', 'err'); return; }
    const reader = new FileReader();
    reader.onerror = () => showToast('读取背景图失败', 'err');
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => { state.bgImage = img; drawBackground(); showToast('背景已更换', 'ok', 1600); };
      img.onerror = () => showToast('背景图解码失败', 'err');
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ============ 剪纸效果 ============
  function applyPaperCutEffect() {
    const l = getActiveLayer();
    if (!l || !l.dataURL) {
      alert('请先绘制一些内容（描个轮廓或涂块面）～');
      return;
    }
    pushUndo();
    const { w, h } = state;
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    const sctx = src.getContext('2d');
    const img = new Image();
    img.onload = () => {
      sctx.drawImage(img, 0, 0, w, h);

      // 1) 提取 alpha，做"边缘高亮+纸张纹理填充"
      const srcData = sctx.getImageData(0, 0, w, h);
      // 输出画布
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const octx = out.getContext('2d');
      octx.clearRect(0, 0, w, h);

      // 用当前画笔色或填充色填充
      let fillStyle, isGradient = false;
      if (state.fillMode === 'paper') {
        // 主色 + 噪点
        fillStyle = state.brushColor;
      } else if (state.fillMode === 'gradient') {
        const g = octx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, state.gradient[0]);
        g.addColorStop(1, state.gradient[1]);
        fillStyle = g;
        isGradient = true;
      } else if (state.fillMode === 'outline') {
        fillStyle = null;
      } else {
        fillStyle = state.brushColor;
      }

      // 填充（按 alpha > 0）
      if (fillStyle) {
        // 先画成单色蒙版，再用 fillStyle 填充
        const mask = document.createElement('canvas');
        mask.width = w; mask.height = h;
        const mctx = mask.getContext('2d');
        const md = mctx.createImageData(w, h);
        for (let i = 0; i < srcData.data.length; i += 4) {
          const a = srcData.data[i+3];
          md.data[i] = 0; md.data[i+1] = 0; md.data[i+2] = 0;
          md.data[i+3] = a > 20 ? 255 : 0;
        }
        mctx.putImageData(md, 0, 0);
        octx.save();
        octx.fillStyle = fillStyle;
        octx.fillRect(0, 0, w, h);
        octx.globalCompositeOperation = 'destination-in';
        octx.drawImage(mask, 0, 0);
        octx.restore();

        if (state.fillMode === 'paper') {
          // 叠纸张纹理
          const paper = document.createElement('canvas');
          paper.width = w; paper.height = h;
          const pctx = paper.getContext('2d');
          const imgData = pctx.createImageData(w, h);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            const n = (Math.random() - 0.5) * 40;
            d[i]   = clamp(230 + n, 0, 255);
            d[i+1] = clamp(215 + n, 0, 255);
            d[i+2] = clamp(200 + n, 0, 255);
            d[i+3] = 255;
          }
          pctx.putImageData(imgData, 0, 0);
          // 按蒙版裁切
          pctx.globalCompositeOperation = 'destination-in';
          pctx.drawImage(mask, 0, 0);
          // 正片叠底到填充上
          octx.save();
          octx.globalCompositeOperation = 'multiply';
          octx.globalAlpha = 0.35;
          octx.drawImage(paper, 0, 0);
          octx.restore();
        }

        // 描边（剪纸感）
        octx.save();
        octx.globalCompositeOperation = 'source-atop';
        octx.strokeStyle = 'rgba(70,45,40,0.28)';
        octx.lineWidth = 1;
        // 卷积提取边缘（简易：用 alpha 的差值）
        drawEdgesSimple(octx, srcData, w, h);
        octx.restore();

        // 轻微阴影投影（剪纸立体感）
        const shadow = document.createElement('canvas');
        shadow.width = w; shadow.height = h;
        const shctx = shadow.getContext('2d');
        shctx.drawImage(mask, 3, 4);
        shctx.filter = 'blur(6px)';
        // 放到 out 下层
        const finalC = document.createElement('canvas');
        finalC.width = w; finalC.height = h;
        const fctx = finalC.getContext('2d');
        fctx.save();
        fctx.globalAlpha = 0.25;
        fctx.fillStyle = '#000';
        // 用蒙版画阴影：简化为 blur(mask shifted)
        const shBlur = document.createElement('canvas');
        shBlur.width = w; shBlur.height = h;
        const sb = shBlur.getContext('2d');
        sb.filter = 'blur(4px)';
        sb.drawImage(mask, 2, 3);
        // 转为黑色半透明
        fctx.drawImage(shBlur, 0, 0);
        fctx.restore();
        fctx.drawImage(out, 0, 0);

        l.dataURL = finalC.toDataURL('image/png');
      } else {
        // outline 模式
        const mask = document.createElement('canvas');
        mask.width = w; mask.height = h;
        const mctx = mask.getContext('2d');
        drawEdgesSimple(mctx, srcData, w, h, state.brushColor);
        l.dataURL = mask.toDataURL('image/png');
      }

      drawActiveLayer();
    };
    img.src = l.dataURL;
  }

  function drawEdgesSimple(ctx, srcData, w, h, color) {
    // 简易 sobel 基于 alpha 通道
    const a = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      return srcData.data[(y * w + x) * 4 + 3];
    };
    const out = ctx.createImageData(w, h);
    const d = out.data;
    let cr = 70, cg = 45, cb = 40;
    if (color) {
      const tmp = document.createElement('canvas').getContext('2d');
      tmp.fillStyle = color; tmp.fillRect(0,0,1,1);
      const p = tmp.getImageData(0,0,1,1).data;
      cr = p[0]; cg = p[1]; cb = p[2];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gx = -a(x-1,y-1) -2*a(x-1,y) -a(x-1,y+1) + a(x+1,y-1) + 2*a(x+1,y) + a(x+1,y+1);
        const gy = -a(x-1,y-1) -2*a(x,y-1) -a(x+1,y-1) + a(x-1,y+1) + 2*a(x,y+1) + a(x+1,y+1);
        const m = Math.min(255, Math.hypot(gx, gy));
        const idx = (y * w + x) * 4;
        if (m > 30) {
          d[idx] = cr; d[idx+1] = cg; d[idx+2] = cb; d[idx+3] = m;
        }
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  // ============ 导出 ============
  let exportFormat = 'png';
  let exportTransparent = false;
  let modalReturnFocus = null;
  const modalFocusSelector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
  const modalFocusable = el => [...el.querySelectorAll(modalFocusSelector)].find(node =>
    node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'
  );
  function openModal(el, trigger) {
    modalReturnFocus = trigger || document.activeElement;
    el.classList.add('show'); el.setAttribute('aria-hidden', 'false');
    const focusInitial = () => { if (el.classList.contains('show')) modalFocusable(el)?.focus({ preventScroll: true }); };
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(focusInitial, reduceMotion ? 0 : 260);
  }
  function closeModal(el) {
    el.classList.remove('show'); el.setAttribute('aria-hidden', 'true');
    const target = modalReturnFocus; modalReturnFocus = null;
    if (target && target.isConnected) target.focus();
  }

  function buildExportComposite() {
    // 返回一个合成好的画布（包含背景或透明）
    const { w, h } = state;
    const out = document.createElement('canvas');
    out.width = w * state.dpr; out.height = h * state.dpr;
    const octx = out.getContext('2d');
    octx.scale(state.dpr, state.dpr);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';

    if (!exportTransparent) {
      // 背景
      if (state.bgGradient) {
        const g = octx.createLinearGradient(0, 0, w, h);
        const col = parseGradientCSS(state.bgGradient);
        col.forEach((c, i) => g.addColorStop(i / (col.length - 1), c));
        octx.fillStyle = g;
      } else {
        octx.fillStyle = state.bgColor;
      }
      octx.fillRect(0, 0, w, h);
      // 纹理
      const t = state.bgTexture;
      if (t === 'paper') {
        const imgData = octx.createImageData(w, h);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const n = (Math.random() - 0.5) * 18;
          d[i]   = clamp(250 + n, 0, 255);
          d[i+1] = clamp(243 + n, 0, 255);
          d[i+2] = clamp(236 + n, 0, 255);
          d[i+3] = 26;
        }
        octx.putImageData(imgData, 0, 0);
      } else if (t === 'grid') {
        octx.strokeStyle = 'rgba(180,140,110,0.15)';
        octx.lineWidth = 1;
        const s = 18;
        for (let x = 0; x <= w; x += s) { octx.beginPath(); octx.moveTo(x,0); octx.lineTo(x,h); octx.stroke(); }
        for (let y = 0; y <= h; y += s) { octx.beginPath(); octx.moveTo(0,y); octx.lineTo(w,y); octx.stroke(); }
      } else if (t === 'dot') {
        octx.fillStyle = 'rgba(180,140,110,0.22)';
        const s = 12;
        for (let x = s/2; x <= w; x += s) for (let y = s/2; y <= h; y += s) {
          octx.beginPath(); octx.arc(x, y, 1.3, 0, Math.PI*2); octx.fill();
        }
      } else if (t === 'stripe') {
        octx.save();
        octx.fillStyle = 'rgba(180,140,110,0.08)';
        const stripeW = 16, rep = 12;
        for (let x = -h; x < w + h; x += rep) {
          octx.save(); octx.translate(x,0); octx.rotate(Math.PI/4);
          octx.fillRect(0,-h, stripeW, h*3); octx.restore();
        }
        octx.restore();
      }
      if (state.bgImage) {
        fitCover(octx, state.bgImage, 0, 0, w, h);
      }
    }

    // 画所有图层
    return new Promise((res) => {
      const drawLayers = async () => {
        for (const l of state.layers) {
          if (!l.visible || !l.dataURL) continue;
          await new Promise(r => {
            const img = new Image();
            img.onload = () => {
              octx.save();
              octx.globalAlpha = l.opacity;
              octx.translate(w/2, h/2);
              octx.rotate(l.rotation * Math.PI/180);
              octx.scale(l.flipH ? -1 : 1, l.flipV ? -1 : 1);
              octx.drawImage(img, -w/2, -h/2, w, h);
              octx.restore();
              r();
            };
            img.src = l.dataURL;
          });
        }
      };
      drawLayers().then(() => res(out));
    });
  }

  function showExportPreview() {
    buildExportComposite().then(cv => {
      const host = $('#exportPreview');
      host.innerHTML = '';
      const img = document.createElement('img');
      img.src = cv.toDataURL('image/png');
      host.appendChild(img);
    });
  }

  function doExport() {
    buildExportComposite().then(cv => {
      if (exportFormat === 'png') {
        const url = cv.toDataURL('image/png');
        downloadURL(url, 'cutovo-' + Date.now() + '.png');
      } else {
        // 转为 SVG（通过 <img> 嵌入 png dataURL 到 svg image 标签）
        const w = state.w * state.dpr, h = state.h * state.dpr;
        const png = cv.toDataURL('image/png');
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <image width="${w}" height="${h}" href="${png}"/>
</svg>`;
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        downloadURL(url, 'cutovo-' + Date.now() + '.svg');
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    });
  }

  function downloadURL(url, filename) {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 100);
  }

  // ============ 排版 / 画布比例 ============
  function applyLayout(ratio) {
    // ratio: '1:1', '4:3', '3:4', '16:9'
    const [a, b] = ratio.split(':').map(Number);
    const parent = canvasWrap.parentElement;
    const pw = parent.clientWidth - 80;
    const ph = parent.clientHeight - 80;
    // 尽量保持和现有像素宽接近，按比例调整高度
    let nw = state.w || Math.round(pw);
    let nh = Math.round(nw * b / a);
    if (nh > ph) { nh = Math.round(ph); nw = Math.round(nh * a / b); }
    canvasWrap.style.aspectRatio = `${a} / ${b}`;
    canvasWrap.style.maxWidth = Math.min(900, pw) + 'px';
    // 重新设置画布
    setTimeout(setupCanvas, 30);
  }

  // ============ 事件绑定 ============
  function bind() {
    // 画布尺寸
    window.addEventListener('resize', setupCanvas);

    // 绘制事件（同时支持鼠标/触摸）
    const addEvt = (el, name, fn, opt = { passive: false }) => el.addEventListener(name, fn, opt);
    addEvt(drawCanvas, 'pointerdown', e => { try { drawCanvas.setPointerCapture(e.pointerId); } catch (_) {} startStroke(e); });
    addEvt(drawCanvas, 'pointermove', moveStroke);
    addEvt(drawCanvas, 'pointerup', endStroke);
    addEvt(drawCanvas, 'pointercancel', endStroke);
    addEvt(drawCanvas, 'lostpointercapture', endStroke);

    // 上传 —— 显式 click() 触发 input（解决部分浏览器/移动端 label 不弹选择框的兼容性）
    const bindUpload = (labelId, inputId, handler) => {
      const label = document.getElementById(labelId);
      const input = document.getElementById(inputId);
      if (!input) return;
      input.addEventListener('change', e => {
        handler(input.files[0]);
        // 重置 value，允许用户重复选择同一文件
        input.value = '';
      });
      if (label && label.tagName !== 'INPUT') {
        label.addEventListener('click', (e) => {
          // 如果用户点击的不是 input 自身，手动触发点击
          if (e.target.tagName !== 'INPUT') {
            e.preventDefault();
            try { input.click(); }
            catch (err) { showToast('无法打开选择框，请刷新重试', 'err'); }
          }
        });
      }
    };
    bindUpload('btnUpload', 'fileInput', handleFileUpload);
    // 引导页按钮：实际上就是 label 本身，外层 <label> 元素没有 id；我们手动找父 label
    (() => {
      const input = document.getElementById('onboardingFile');
      if (input) {
        input.addEventListener('change', e => {
          handleFileUpload(input.files[0]);
          input.value = '';
        });
        const parent = input.closest('label');
        if (parent) {
          parent.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
              e.preventDefault();
              try { input.click(); }
              catch (err) { showToast('无法打开选择框，请刷新重试', 'err'); }
            }
          });
        }
      }
    })();
    // 背景自定义图片
    const bgInput = document.getElementById('bgFileInput');
    if (bgInput) {
      bgInput.addEventListener('change', e => {
        handleBgFileUpload(bgInput.files[0]);
        bgInput.value = '';
      });
      const bgLabel = bgInput.closest('label') || bgInput.parentElement;
      if (bgLabel && bgLabel.tagName !== 'INPUT') {
        bgLabel.addEventListener('click', (e) => {
          if (e.target.tagName !== 'INPUT') {
            e.preventDefault();
            try { bgInput.click(); } catch(err){}
          }
        });
      }
    }

    // 顶部按钮
    $('#btnBg').onclick = () => openModal($('#bgModal'), $('#btnBg'));
    $('#closeBg').onclick = () => closeModal($('#bgModal'));
    $('#btnSave').onclick = () => { openModal($('#saveModal'), $('#btnSave')); showExportPreview(); };
    $('#closeSave').onclick = () => closeModal($('#saveModal'));

    // 工具切换
    $$('.tool[data-tool]').forEach(btn => {
      btn.onclick = () => {
        $$('.tool[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.tool = btn.dataset.tool;
        drawCanvas.style.cursor = state.tool === 'eraser' ? 'cell' : state.tool === 'picker' ? 'crosshair' : 'crosshair';
      };
    });
    $('#toolPicker').onclick = () => {
      $$('.tool[data-tool]').forEach(b => b.classList.remove('active'));
      $('#toolPicker').classList.add('active');
      state.tool = 'picker';
    };

    // 撤销/重做
    $('#toolUndo').onclick = undo;
    $('#toolRedo').onclick = redo;

    // Turn visual swatches into native, named keyboard-operable radio controls.
    const upgradeChoices = (selector, role, labelFor) => {
      $$(selector).forEach((old, index, all) => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = old.className; btn.style.cssText = old.style.cssText;
        btn.dataset.color = old.dataset.color || ''; btn.dataset.gradient = old.dataset.gradient || '';
        btn.dataset.texture = old.dataset.texture || ''; btn.setAttribute('role', role);
        btn.setAttribute('aria-label', labelFor(old)); btn.setAttribute('aria-checked', String(old.classList.contains('active')));
        btn.tabIndex = old.classList.contains('active') ? 0 : -1;
        old.replaceWith(btn);
        btn.addEventListener('keydown', e => {
          if (!['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(e.key)) return;
          e.preventDefault(); const items = $$(selector); let i = items.indexOf(btn);
          i = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (['ArrowRight','ArrowDown'].includes(e.key) ? 1 : items.length - 1)) % items.length;
          items[i].focus(); items[i].click();
        });
      });
    };
    upgradeChoices('#presetColors .dot', 'radio', el => `画笔颜色 ${el.dataset.color}`);
    upgradeChoices('#bgSwatches .swatch', 'radio', el => el.dataset.color ? `背景颜色 ${el.dataset.color}` : '渐变背景');
    upgradeChoices('#bgTextures .texture-thumb', 'radio', el => `背景纹理 ${el.textContent.trim()}`);

    // 笔刷参数
    const smoothSlider = $('#smoothSlider');
    smoothSlider.oninput = () => {
      state.smooth = smoothSlider.value / 100;
      $('#smoothVal').textContent = smoothSlider.value + '%';
    };
    const sizeSlider = $('#sizeSlider');
    sizeSlider.oninput = () => {
      state.brushSize = +sizeSlider.value;
      $('#sizeVal').textContent = sizeSlider.value + 'px';
    };
    $('#colorPicker').oninput = (e) => state.brushColor = e.target.value;
    $$('#presetColors .dot').forEach(d => {
      d.onclick = () => {
        $$('#presetColors .dot').forEach(x => { x.setAttribute('aria-checked', String(x === d)); x.tabIndex = x === d ? 0 : -1; });
        state.brushColor = d.dataset.color;
        $('#colorPicker').value = d.dataset.color;
      };
    });

    // 背景色
    $$('#bgSwatches .swatch').forEach(sw => {
      sw.onclick = () => {
        $$('#bgSwatches .swatch').forEach(x => x.classList.remove('active'));
        sw.classList.add('active');
        $$('#bgSwatches .swatch').forEach(x => { x.setAttribute('aria-checked', String(x === sw)); x.tabIndex = x === sw ? 0 : -1; });
        if (sw.dataset.gradient) {
          state.bgGradient = sw.dataset.gradient;
          state.bgColor = null;
        } else {
          state.bgColor = sw.dataset.color;
          state.bgGradient = null;
          $('#bgColorPicker').value = sw.dataset.color;
        }
        drawBackground();
      };
    });
    $('#bgColorPicker').oninput = (e) => {
      state.bgColor = e.target.value;
      state.bgGradient = null;
      $$('#bgSwatches .swatch').forEach(x => x.classList.remove('active'));
      drawBackground();
    };
    $$('#bgTextures .texture-thumb').forEach(t => {
      t.onclick = () => {
        $$('#bgTextures .texture-thumb').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        $$('#bgTextures .texture-thumb').forEach(x => { x.setAttribute('aria-checked', String(x === t)); x.tabIndex = x === t ? 0 : -1; });
        state.bgTexture = t.dataset.texture;
        drawBackground();
      };
    });

    // 图层面板
    $('#toolLayer').onclick = () => togglePanel('#layerPanel');
    $('#closeLayer').onclick = () => { $('#layerPanel').classList.remove('show'); $('#toolLayer').focus(); };
    $('#addLayer').onclick = () => {
      pushUndo();
      newLayer();
      refreshLayerListUI();
      drawActiveLayer();
    };

    // 变换面板
    $('#toolTransform').onclick = () => togglePanel('#transformPanel');
    $('#closeTransform').onclick = () => { $('#transformPanel').classList.remove('show'); $('#toolTransform').focus(); };
    $('#opacityRange').oninput = (e) => {
      const l = getActiveLayer(); if (!l) return;
      l.opacity = +e.target.value / 100;
      drawActiveLayer();
      refreshLayerListUI();
    };
    $('#flipH').onclick = () => { const l = getActiveLayer(); if (!l) return; pushUndo(); l.flipH = !l.flipH; drawActiveLayer(); };
    $('#flipV').onclick = () => { const l = getActiveLayer(); if (!l) return; pushUndo(); l.flipV = !l.flipV; drawActiveLayer(); };
    $('#rotL').onclick  = () => { const l = getActiveLayer(); if (!l) return; pushUndo(); l.rotation = (l.rotation - 90) % 360; drawActiveLayer(); };
    $('#rotR').onclick  = () => { const l = getActiveLayer(); if (!l) return; pushUndo(); l.rotation = (l.rotation + 90) % 360; drawActiveLayer(); };

    // 纹理/填充面板
    $('#toolTexture').onclick = () => togglePanel('#texturePanel');
    $('#closeTexture').onclick = () => { $('#texturePanel').classList.remove('show'); $('#toolTexture').focus(); };
    $$('#texturePanel .seg-btn[data-fill]').forEach(b => {
      b.onclick = () => {
        $$('#texturePanel .seg-btn[data-fill]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        state.fillMode = b.dataset.fill;
        $('#fillGradientSection').style.display = state.fillMode === 'gradient' ? 'block' : 'none';
      };
    });
    $('#gradCol1').oninput = e => state.gradient[0] = e.target.value;
    $('#gradCol2').oninput = e => state.gradient[1] = e.target.value;
    $('#applyPaperCut').onclick = applyPaperCutEffect;

    // 排版
    $('#toolLayout').onclick = () => {
      // 简易：弹出快捷比例选择（用临时浮层）
      showLayoutPicker();
    };

    // 导出
    $('#toolExport').onclick = () => { openModal($('#saveModal'), $('#toolExport')); showExportPreview(); };
    $$('.seg-btn[data-format]').forEach(b => {
      b.onclick = () => {
        $$('.seg-btn[data-format]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        exportFormat = b.dataset.format;
      };
    });
    $('#optTransparent').onchange = (e) => {
      exportTransparent = e.target.checked;
      showExportPreview();
    };
    $('#doExport').onclick = doExport;

    // 关闭所有面板：按 ESC
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = $('.modal.show');
        if (modal) closeModal(modal);
        else $$('.side-panel.show').forEach(el => { el.classList.remove('show'); const trigger = document.getElementById(el.dataset.returnFocus); if (trigger) trigger.focus(); });
      }
      const activeModal = $('.modal.show');
      if (activeModal && e.key === 'Tab') {
        const items = $$(modalFocusSelector, activeModal).filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
        if (items.length) { const first = items[0], last = items[items.length - 1];
          if (!activeModal.contains(document.activeElement)) { e.preventDefault(); first.focus({ preventScroll: true }); }
          else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      // 快捷键
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey ? e.key.toLowerCase() === 'z' : e.key.toLowerCase() === 'y')) { e.preventDefault(); redo(); }
      if (e.key === '[') { sizeSlider.value = Math.max(1, +sizeSlider.value - 1); sizeSlider.oninput(); }
      if (e.key === ']') { sizeSlider.value = Math.min(50, +sizeSlider.value + 1); sizeSlider.oninput(); }
      if (e.key.toLowerCase() === 'b') { document.querySelector('.tool[data-tool="brush"]').click(); }
      if (e.key.toLowerCase() === 'e') { document.querySelector('.tool[data-tool="eraser"]').click(); }
    });
  }

  function togglePanel(selector) {
    const panel = document.querySelector(selector);
    const isOpen = panel.classList.contains('show');
    $$('.side-panel.show').forEach(p => p.classList.remove('show'));
    if (!isOpen) { panel.classList.add('show'); const trigger = panel.id === 'layerPanel' ? $('#toolLayer') : panel.id === 'transformPanel' ? $('#toolTransform') : $('#toolTexture'); panel.dataset.returnFocus = trigger.id; requestAnimationFrame(() => $('#'+(panel.id === 'layerPanel' ? 'closeLayer' : panel.id === 'transformPanel' ? 'closeTransform' : 'closeTexture')).focus()); }
  }

  function showLayoutPicker() {
    const host = document.createElement('div');
    host.className = 'modal show'; host.setAttribute('role','dialog'); host.setAttribute('aria-modal','true'); host.setAttribute('aria-label','画布比例'); host.setAttribute('aria-hidden','false');
    host.style.zIndex = '600';
    const returnFocus = document.activeElement;
    const close = () => { host.remove(); if (returnFocus && returnFocus.isConnected) returnFocus.focus(); };
    host.onclick = (e) => { if (e.target === host) close(); };
    host.innerHTML = `
      <div class="modal-card" style="width:min(360px,90vw)">
        <div class="modal-head"><h3>画布比例</h3><button class="close">✕</button></div>
        <div class="modal-body">
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
            <button class="t-btn" data-r="1:1">1:1 方图</button>
            <button class="t-btn" data-r="4:3">4:3 横图</button>
            <button class="t-btn" data-r="3:4">3:4 竖图</button>
            <button class="t-btn" data-r="16:9">16:9 宽屏</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(host);
    requestAnimationFrame(() => host.querySelector('.close').focus());
    host.querySelector('.close').onclick = close;
    host.querySelectorAll('button[data-r]').forEach(b => {
      b.onclick = () => { applyLayout(b.dataset.r); close(); };
    });
  }

  // ============ 启动 ============
  function init() {
    // 初始化图层
    newLayer('图层 1');
    refreshLayerListUI();
    bind();
    // 等待 CSS 布局
    requestAnimationFrame(() => {
      setupCanvas();
      updateUndoButtons();
      updateTransformPanel();
    });
  }

  // DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
