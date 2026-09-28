import { getSuccess, commentsFor, addComment } from '../data.js';
import { esc, timeAgo } from '../ui.js';

// Detalle de un reencuentro con comentarios.
export default async function success(el, { id }, { user, refresh }) {
  const s = await getSuccess(id);
  if (!s) {
    el.innerHTML = `<div class="card center"><h2>Esta historia ya no está disponible</h2><a class="btn secondary" href="#/">Volver</a></div>`;
    return;
  }
  const comments = await commentsFor(id);

  el.innerHTML = `
    <article class="card story">
      <img class="story-photo" src="${esc(s.photo)}" alt="${esc(s.petName)}">
      <h1>${esc(s.petName)} volvió a casa 💛</h1>
      <p class="muted">${timeAgo(s.createdAt)}</p>
      ${s.story ? `<p>${esc(s.story)}</p>` : ''}
    </article>
    <section class="card">
      <h2>Comentarios (${comments.length})</h2>
      <ul class="comments">
        ${comments.map((c) => `
          <li><strong>${esc(c.author)}</strong> <small>${timeAgo(c.createdAt)}</small><p>${esc(c.text)}</p></li>`).join('') || '<li class="muted">Sé el primero en comentar.</li>'}
      </ul>
      <form class="form inline" id="comment">
        <input name="text" required maxlength="300" placeholder="Escribe algo lindo…">
        <button class="btn primary">Enviar</button>
      </form>
    </section>`;

  el.querySelector('#comment').addEventListener('submit', async (e) => {
    e.preventDefault();
    await addComment(user, id, new FormData(e.target).get('text').trim());
    refresh();
  });
}
