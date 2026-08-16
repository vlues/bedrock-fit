/* ===================== Bedrock — tiny dependency-free line chart ===================== */

const MiniChart = (() => {
  function draw(canvas, series, opts = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 34, r: 12, t: 14, b: 22 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    const styles = getComputedStyle(document.documentElement);
    const clay = styles.getPropertyValue('--clay').trim() || '#b5674a';
    const olive = styles.getPropertyValue('--olive').trim() || '#6f7d55';
    const stone = styles.getPropertyValue('--stone').trim() || '#d9cdb8';
    const bark = styles.getPropertyValue('--bark-soft').trim() || '#6b5d4f';

    const allVals = series.flatMap(s => s.points.map(p => p.y)).filter(v => v != null && !isNaN(v));
    if (!allVals.length) {
      ctx.fillStyle = bark; ctx.font = '13px sans-serif';
      ctx.fillText('Log a couple of sessions to see this fill in.', 10, h / 2);
      return;
    }
    let minY = Math.min(...allVals), maxY = Math.max(...allVals);
    if (minY === maxY) { minY -= 1; maxY += 1; }
    const pdRange = (maxY - minY) * 0.12;
    minY -= pdRange; maxY += pdRange;

    // axes
    ctx.strokeStyle = stone; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();

    ctx.fillStyle = bark; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxY), pad.l - 6, pad.t + 8);
    ctx.fillText(Math.round(minY), pad.l - 6, h - pad.b);

    const colors = [clay, olive];
    series.forEach((s, si) => {
      const pts = s.points.filter(p => p.y != null && !isNaN(p.y));
      if (pts.length < 1) return;
      const xStep = pts.length > 1 ? plotW / (pts.length - 1) : 0;
      ctx.strokeStyle = colors[si % colors.length];
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = pad.l + xStep * i;
        const y = pad.t + plotH - ((p.y - minY) / (maxY - minY)) * plotH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // dots
      ctx.fillStyle = colors[si % colors.length];
      pts.forEach((p, i) => {
        const x = pad.l + xStep * i;
        const y = pad.t + plotH - ((p.y - minY) / (maxY - minY)) * plotH;
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      });

      // projected dashed continuation
      if (s.projection && s.projection.length) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = colors[si % colors.length];
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        const lastX = pad.l + xStep * (pts.length - 1);
        const lastY = pad.t + plotH - ((pts[pts.length - 1].y - minY) / (maxY - minY)) * plotH;
        ctx.moveTo(lastX, lastY);
        const totalProjPoints = pts.length - 1 + s.projection.length;
        s.projection.forEach((p, i) => {
          const x = pad.l + xStep * (pts.length - 1 + i + 1);
          const y = pad.t + plotH - ((p.y - minY) / (maxY - minY)) * plotH;
          ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    });
  }
  function drawBars(canvas, items) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 30, r: 10, t: 14, b: 26 };
    const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;

    const styles = getComputedStyle(document.documentElement);
    const clay = styles.getPropertyValue('--clay').trim() || '#b5674a';
    const stone = styles.getPropertyValue('--stone').trim() || '#d9cdb8';
    const bark = styles.getPropertyValue('--bark-soft').trim() || '#6b5d4f';

    if (!items.length || items.every(i => !i.value)) {
      ctx.fillStyle = bark; ctx.font = '13px sans-serif';
      ctx.fillText('Log a few sessions to see this fill in.', 10, h / 2);
      return;
    }
    const max = Math.max(...items.map(i => i.value), 1);
    ctx.strokeStyle = stone; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b); ctx.stroke();

    const bw = plotW / items.length;
    ctx.textAlign = 'center';
    items.forEach((it, i) => {
      const bh = (it.value / max) * plotH;
      const x = pad.l + i * bw + bw * 0.18;
      const y = h - pad.b - bh;
      ctx.fillStyle = clay;
      ctx.fillRect(x, y, bw * 0.64, Math.max(2, bh));
      ctx.fillStyle = bark; ctx.font = '10px sans-serif';
      ctx.fillText(it.label, pad.l + i * bw + bw / 2, h - pad.b + 12);
    });
  }

  return { draw, drawBars };
})();
