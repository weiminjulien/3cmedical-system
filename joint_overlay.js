(function () {
  'use strict';

  let dialAngle = 0;
  let draggingDial = false;
  let scaledShapesFor = '';

  const overlay = {
    file: 'elbow_knee.jpg',
    referenceWidth: 2048,
    referenceHeight: 1308,
    sourceShapeWidth: 2560,
    sourceShapeHeight: 1635,
    elbow: {
      center: {x: 568, y: 807}, baseAngle: 180,
      contour: [[382,749],[365,769],[347,805],[350,835],[380,854],[413,856],[440,884],[484,925],[571,929],[650,911],[709,879],[739,847],[744,804],[734,766],[699,735],[657,717],[605,705],[527,705],[451,712],[399,729]]
    },
    knee: {
      center: {x: 1401, y: 768}, baseAngle: 0,
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

  function drawArrow(def, visualDegrees, displayedDegrees) {
    const center = pt(def.center);
    const contour = def.contour.map(p => [p[0] * sx(), p[1] * sy()]);
    const end = rayHit(center, visualDegrees, contour);
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
    const tx = x1, ty = y1 - 58 / safeScale;
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
    const degrees = Math.atan2(p.y - d.y, p.x - d.x) * 180 / Math.PI;
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
