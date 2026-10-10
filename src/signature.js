// Recuadro para firmar con el dedo (o el mouse). Devuelve la firma como PNG.

export function signaturePad(box, { initial = '', onChange = () => {} } = {}) {
  box.innerHTML = `
    <div class="sig-pad">
      <canvas aria-label="Firma aquí"></canvas>
      <span class="sig-hint">Firma aquí con el dedo</span>
      <button type="button" class="link small sig-clear">Borrar</button>
    </div>`;
  const pad = box.querySelector('.sig-pad');
  const canvas = box.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  let empty = true;
  let drawing = false;
  let last = null;

  const size = () => {
    const r = canvas.getBoundingClientRect();
    const keep = empty ? null : canvas.toDataURL();
    canvas.width = Math.round(r.width * 2);
    canvas.height = Math.round(r.height * 2);
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1f2a44';
    if (keep) paint(keep);
  };
  const paint = (src) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setEmpty(false);
    };
    img.src = src;
  };
  const setEmpty = (v) => {
    empty = v;
    pad.classList.toggle('signed', !v);
    onChange(!v);
  };
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    last = point(e);
    ctx.beginPath();
    ctx.arc(last[0], last[1], 2.5, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    if (empty) setEmpty(false);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(...last);
    ctx.lineTo(...p);
    ctx.stroke();
    last = p;
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  box.querySelector('.sig-clear').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
  });

  requestAnimationFrame(() => {
    size();
    if (initial) paint(initial);
  });

  return {
    isEmpty: () => empty,
    /** PNG chico (máx. 600 px de ancho) para guardarlo en la base. */
    toDataURL() {
      if (empty) return '';
      const w = Math.min(600, canvas.width);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = Math.round(canvas.height * (w / canvas.width));
      out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
  };
}
