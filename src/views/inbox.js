import { myNotifications, markRead } from '../data.js';
import { esc, timeAgo, changed, go } from '../ui.js';

export default async function inbox(el, _params, { user }) {
  const list = await myNotifications(user);
  el.innerHTML = `
    <div class="card">
      <h1>Avisos</h1>
      ${list.length ? `<ul class="inbox">
        ${list.map((n) => `
          <li class="${n.read ? '' : 'unread'} ${n.type}" data-id="${n.id}">
            <span class="inbox-icon">${n.type === 'match' ? '🐾' : n.type === 'admin' ? '📢' : '🔔'}</span>
            <span><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p><small>${timeAgo(n.createdAt)}</small></span>
          </li>`).join('')}
      </ul>` : '<div class="empty"><div class="empty-emoji">📭</div><p>No tienes avisos todavía.</p></div>'}
    </div>`;

  el.querySelectorAll('.inbox li').forEach((li) =>
    li.addEventListener('click', async () => {
      const n = list.find((x) => x.id === li.dataset.id);
      await markRead(n);
      changed();
      if (n.url && n.url !== '#/avisos') go(n.url);
      else li.classList.remove('unread');
    }),
  );
}
