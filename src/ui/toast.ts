let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container) return container;
  const el = document.createElement('div');
  el.className = 'toast-stack';
  document.body.appendChild(el);
  container = el;
  return el;
}

export type ToastKind = 'info' | 'warn' | 'error';

export function toast(message: string, kind: ToastKind = 'info', ttl = 3200): void {
  const root = ensureContainer();
  const item = document.createElement('div');
  item.className = `toast toast-${kind}`;
  item.textContent = message;
  root.appendChild(item);
  requestAnimationFrame(() => item.classList.add('toast-in'));
  setTimeout(() => {
    item.classList.remove('toast-in');
    setTimeout(() => item.remove(), 260);
  }, ttl);
}
