export interface DialogHandle {
  root: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close: () => void;
}

export function openDialog(layer: HTMLElement, title: string): DialogHandle {
  layer.hidden = false;
  const root = document.createElement('div');
  root.className = 'dialog';

  const head = document.createElement('header');
  head.className = 'dialog-head';
  const h = document.createElement('h2');
  h.textContent = title;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'dialog-close';
  closeBtn.textContent = '✕';
  head.append(h, closeBtn);

  const body = document.createElement('div');
  body.className = 'dialog-body';

  const footer = document.createElement('div');
  footer.className = 'dialog-footer';

  root.append(head, body, footer);
  layer.appendChild(root);

  const close = (): void => {
    root.remove();
    if (layer.children.length === 0) layer.hidden = true;
    document.removeEventListener('keydown', onKey, true);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  closeBtn.addEventListener('click', close);
  layer.addEventListener('click', (event) => {
    if (event.target === layer) close();
  });
  document.addEventListener('keydown', onKey, true);

  return { root, body, footer, close };
}

export function dialogButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn ${className}`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

export function fieldRow(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, control);
  return wrap;
}

export function makeSelect(options: { value: string; label: string }[], selected?: string): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'input';
  for (const option of options) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    if (selected !== undefined && option.value === selected) opt.selected = true;
    select.appendChild(opt);
  }
  // 逐项标记 selected 在部分实现里不会立刻反映到 select.value，显式赋值一次（值不在表里就不动）
  if (selected !== undefined && options.some((o) => o.value === selected)) select.value = selected;
  return select;
}

export function makeNumberInput(value: number, min: number, max: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'input';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  return input;
}

export function makeTextInput(value: string, placeholder = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

/** 复选框行（与 metaPanel 的「显示歌词」同款标记：.field.field-check，输入框在前标签在后） */
export function makeCheckbox(
  label: string,
  checked: boolean,
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = document.createElement('label');
  wrap.className = 'field field-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(input, span);
  return { wrap, input };
}
