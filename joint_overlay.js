(function () {
  'use strict';

  let dialAngle = 0;
  let draggingDial = false;
  let scaledShapesFor = '';
  let sampledImage = null;
  let sampledPixels = null;

  const overlay = {
    file: 'elbow_knee.jpg',
    referenceWidth: 2048,
    referenceHeight: 1308,
    sourceShapeWidth: 2560,
    sourceShapeHeight: 1635,
    elbow: {
      // 根据0°、±90°、180°四张实机截图校准。
      center: {x: 598, y: 845}, baseAngle: 180, labelOffsetY: -20,
      contour: [[382,749],[365,769],[347,805],[350,835],[380,854],[413,856],[440,884],[484,925],[571,929],[650,911],[709,879],[739,847],[744,804],[734,766],[699,735],[657,717],[605,705],[527,705],[451,712],[399,729]]
    },
    knee: {
      // 根据90°和179°实机截图校准：原中心需向右约65 px、向下约56 px。
      center: {x: 1466, y: 824}, baseAngle: 0,
      contour: [[1403,564],[1326,575],[1274,610],[1235,657],[1164,704],[1160,768],[1162,836],[1194,890],[1246,913],[1319,950],[1399,972],[1481,963],[1556,923],[1598,879],[1626,823],[1621,757],[1604,697],[1581,637],[1543,589],[1489,565]]
    },
    dial: {x: 1018, y: 805, r: 54}
  };

  function sx() { return loadedImage ? loadedImage.width / overlay.referenceWidth : 1; }
  function sy() { return loadedImage ? loadedImage.height / overlay.referenceHeight : 1; }
  function pt(p) { return {x: p.x * sx(), y: p.y * sy()}; }
  function shownX(x) { return isFlipped && loadedImage ? loadedImage.width - x : x; }

  function ensureElbowShapesScaled() {
    if (!loadedImage || currentFileName !== overlay.file || scaledShapesFor === `${loadedImage.width}x${loadedImage.height}`) return;
    const list = shapesData[overlay.file];
    if (!Array.isArray(list) || !list.length) return;
    const maxX = Math.max(...list.flatMap(s => s.coords.filter((_, i) => i % 2 === 0)));
    if (maxX > loadedImage.width * 1.05) {
      const kx = loadedImage.width / overlay.sourceShapeWidth;
      const ky = loadedImage.height / overlay.sourceShapeHeight;
      list.forEach(shape => {
        shape.coords = shape.coords.map((v, i) => v * (i % 2 === 0 ? kx : ky));
      });
    }
    scaledShapesFor = `${loadedImage.width}x${loadedImage.height}`;
  }

  function rayHit(center, degrees, contour) {
    const a = degrees * Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = Infinity, result = null;
    for (let i = 0; i < contour.length; i++) {
      const p = contour[i], q = contour[(i + 1) % contour.length];
      const ex = q[0] - p[0], ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-8) continue;
      const rx = p[0] - center.x, ry = p[1] - center.y;
      const t = (rx * ey - ry * ex) / den;
      const u = (rx * dy - ry * dx) / den;
      if (t >= 0 && u >= 0 && u <= 1 && t < best) {
        best = t;
        result = {x: center.x + t * dx, y: center.y + t * dy};
      }
    }
    return result;
  }

  function getSourcePixels() {
    if (!loadedImage) return null;
    if (sampledImage === loadedImage && sampledPixels) return sampledPixels;
    try {
      const c = document.createElement('canvas');
      c.width = loadedImage.width;
      c.height = loadedImage.height;
      const cctx = c.getContext('2d', {willReadFrequently: true});
      cctx.drawImage(loadedImage, 0, 0);
      sampledPixels = cctx.getImageData(0, 0, c.width, c.height);
      sampledImage = loadedImage;
      return sampledPixels;
    } catch (_) {
      sampledImage = loadedImage;
      sampledPixels = null;
      return null;
    }
  }

  function isColoredBoundary(data, x, y) {
    const w = data.width, h = data.height;
    let colored = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const px = Math.round(x + ox), py = Math.round(y + oy);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const i = (py * w + px) * 4;
        const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2];
        const high = Math.max(r, g, b), low = Math.min(r, g, b);
        if (high > 85 && high - low > 45) colored++;
      }
    }
    return colored >= 2;
  }

  function imageBoundaryHit(center, degrees) {
    const data = getSourcePixels();
    if (!data) return null;
    const a = degrees * Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const unitScale = Math.min(sx(), sy());
    const start = 65 * unitScale;
    const maximum = 520 * unitScale;
    let run = 0, first = null;
    for (let distance = start; distance <= maximum; distance += 1) {
      const x = center.x + dx * distance;
      const y = center.y + dy * distance;
      if (x < 0 || y < 0 || x >= data.width || y >= data.height) break;
      if (isColoredBoundary(data, x, y)) {
        if (run === 0) first = {x, y};
        run++;
        if (run >= 3) return first;
      } else {
        run = 0;
        first = null;
      }
    }
    return null;
  }

  function drawArrow(def, visualDegrees, displayedDegrees) {
    const center = pt(def.center);
    const contour = def.contour.map(p => [p[0] * sx(), p[1] * sy()]);
    // 优先寻找原图上的真实彩色皮肤边缘，失败时才使用备用轮廓。
    const end = imageBoundaryHit(center, visualDegrees) || rayHit(center, visualDegrees, contour);
    if (!end) return;
    const x1 = shownX(center.x), y1 = center.y;
    const x2 = shownX(end.x), y2 = end.y;
    const vx = x2 - x1, vy = y2 - y1;
    const length = Math.hypot(vx, vy) || 1;
    const ux = vx / length, uy = vy / length;
    const safeScale = Math.max(currentScale, 0.25);
    // 只画皮肤外侧的宽箭头：箭尖贴住皮肤，方向朝向关节中心。
    const headLength = 25 / safeScale;
    const headWidth = 18 / safeScale;
    const tailLength = 68 / safeScale;
    const tailHalfWidth = 9 / safeScale;
    const baseX = x2 + ux * headLength;
    const baseY = y2 + uy * headLength;
    const tailX = x2 + ux * tailLength;
    const tailY = y2 + uy * tailLength;

    ctx.save();
    ctx.fillStyle = '#e00018';
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(baseX - uy * headWidth, baseY + ux * headWidth);
    ctx.lineTo(baseX - uy * tailHalfWidth, baseY + ux * tailHalfWidth);
    ctx.lineTo(tailX - uy * tailHalfWidth, tailY + ux * tailHalfWidth);
    ctx.lineTo(tailX + uy * tailHalfWidth, tailY - ux * tailHalfWidth);
    ctx.lineTo(baseX + uy * tailHalfWidth, baseY - ux * tailHalfWidth);
    ctx.lineTo(baseX + uy * headWidth, baseY - ux * headWidth);
    ctx.closePath(); ctx.fill();

    const sign = displayedDegrees > 0 ? '+' : displayedDegrees < 0 ? '−' : '';
    const text = sign + Math.abs(displayedDegrees) + '°';
    ctx.font = `bold ${24 / safeScale}px Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // 左图的度数稍低，避免挡住上方皮肤；右图保持原来的位置。
    const labelOffsetY = def.labelOffsetY == null ? -58 : def.labelOffsetY;
    const tx = x1, ty = y1 + labelOffsetY / safeScale;
    const width = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(tx - width / 2 - 7, ty - 18 / safeScale, width + 14, 36 / safeScale);
    ctx.fillStyle = '#bc0016'; ctx.fillText(text, tx, ty);
    ctx.restore();
  }

  function drawDial() {
    const d = pt(overlay.dial);
    const x = shownX(d.x), y = d.y;
    const r = overlay.dial.r * Math.min(sx(), sy());
    const safeScale = Math.max(currentScale, 0.25);
    const a = (isFlipped ? 180 - dialAngle : dialAngle) * Math.PI / 180;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 10 / safeScale;
    ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.strokeStyle = '#566371';
    ctx.lineWidth = 3 / safeScale;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#e00018'; ctx.lineWidth = 5 / safeScale; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * .72, y + Math.sin(a) * r * .72); ctx.stroke();
    ctx.fillStyle = '#e00018'; ctx.beginPath(); ctx.arc(x, y, 7 / safeScale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#27313a'; ctx.font = `bold ${18 / safeScale}px Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('↻', x, y + r * .48);
    ctx.restore();
  }

  function drawOverlay() {
    if (currentFileName !== overlay.file || !loadedImage) return;
    drawArrow(overlay.elbow, overlay.elbow.baseAngle + dialAngle, dialAngle);
    drawArrow(overlay.knee, overlay.knee.baseAngle - dialAngle, -dialAngle);
    drawDial();
  }

  function onDial(p) {
    if (currentFileName !== overlay.file) return false;
    const d = pt(overlay.dial);
    return Math.hypot(p.x - d.x, p.y - d.y) <= overlay.dial.r * Math.min(sx(), sy()) * 1.25;
  }

  function setDialFromPoint(p) {
    const d = pt(overlay.dial);
    let degrees = Math.atan2(p.y - d.y, p.x - d.x) * 180 / Math.PI;
    // 靠近水平或垂直方向时自动吸附，鼠标不必恰好落在单个像素上。
    const snapped = Math.round(degrees / 90) * 90;
    if (Math.abs(degrees - snapped) <= 4) degrees = snapped;
    // 左侧水平位统一显示为 +180° / −180°，避免停在179°。
    if (degrees === -180) degrees = 180;
    dialAngle = Math.max(-180, Math.min(180, Math.round(degrees)));
    requestAnimationFrame(renderCanvas);
  }

  const baseRenderCanvas = renderCanvas;
  renderCanvas = function () {
    ensureElbowShapesScaled();
    baseRenderCanvas();
    drawOverlay();
  };

  const baseMouseDown = onCanvasMouseDown;
  onCanvasMouseDown = function (event) {
    if (event.button !== 0) return;
    const p = getMouseLogicPos(event);
    if (!measureMode && onDial(p)) {
      draggingDial = true;
      setDialFromPoint(p);
      return;
    }
    baseMouseDown(event);
  };

  const baseMouseMove = onCanvasMouseMove;
  onCanvasMouseMove = function (event) {
    if (draggingDial) {
      setDialFromPoint(getMouseLogicPos(event));
      return;
    }
    baseMouseMove(event);
  };

  window.addEventListener('mouseup', () => { draggingDial = false; });
  window.addEventListener('touchend', () => { draggingDial = false; }, {passive: true});
})();
