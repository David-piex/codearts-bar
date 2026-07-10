(() => {
  let frame = 0;
  function draw(canvas, rows, empty) {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      empty.hidden = rows.length > 0;
      canvas.hidden = rows.length === 0;
      if (!rows.length) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      const width = rect.width,
        height = rect.height,
        pad = { left: 8, right: 8, top: 10, bottom: 22 };
      const max = Math.max(1, ...rows.map((item) => Number(item.total) || 0));
      const x = (index) =>
        pad.left +
        (rows.length === 1 ? 0 : index / (rows.length - 1)) *
          (width - pad.left - pad.right);
      const y = (value) =>
        pad.top +
        (1 - (Number(value) || 0) / max) * (height - pad.top - pad.bottom);
      const style = getComputedStyle(document.documentElement);
      const line = style.getPropertyValue("--line-strong").trim();
      const accent = style.getPropertyValue("--accent").trim();
      const cyan = style.getPropertyValue("--cyan").trim();
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      for (let index = 0; index < 4; index += 1) {
        const gridY = pad.top + (index * (height - pad.top - pad.bottom)) / 3;
        ctx.beginPath();
        ctx.moveTo(pad.left, gridY);
        ctx.lineTo(width - pad.right, gridY);
        ctx.stroke();
      }
      const path = (key) => {
        ctx.beginPath();
        rows.forEach((item, index) => {
          const px = x(index),
            py = y(item[key]);
          index ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
      };
      const gradient = ctx.createLinearGradient(
        0,
        pad.top,
        0,
        height - pad.bottom,
      );
      gradient.addColorStop(0, accent);
      gradient.addColorStop(1, "transparent");
      path("total");
      ctx.lineTo(x(rows.length - 1), height - pad.bottom);
      ctx.lineTo(x(0), height - pad.bottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.globalAlpha = 0.13;
      ctx.fill();
      ctx.globalAlpha = 1;
      path("total");
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
      path("output");
      ctx.strokeStyle = cyan;
      ctx.lineWidth = 1.35;
      ctx.stroke();
      ctx.fillStyle = style.getPropertyValue("--muted").trim();
      ctx.font = "9px sans-serif";
      const first = new Date(rows[0].start || Date.now()),
        last = new Date(rows.at(-1).start || Date.now());
      ctx.textAlign = "left";
      ctx.fillText(
        `${first.getMonth() + 1}/${first.getDate()}`,
        pad.left,
        height - 5,
      );
      ctx.textAlign = "right";
      ctx.fillText(
        `${last.getMonth() + 1}/${last.getDate()}`,
        width - pad.right,
        height - 5,
      );
    });
  }
  window.CodeArtsChart = Object.freeze({ draw });
})();
