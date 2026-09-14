// Inventory: mineable resources, hotbar selection, persistence, toasts.

export type ItemId = 'dirt' | 'stone' | 'wood' | 'copper' | 'iron' | 'gold';

export interface ItemDef {
  id: ItemId;
  name: string;
  icon: string;
  blurb: string;
  placeable: boolean;
}

export const ITEMS: ItemDef[] = [
  { id: 'dirt', name: 'Dirt', icon: '🟫', blurb: 'Dug from the earth. Build mounds with it.', placeable: true },
  { id: 'stone', name: 'Stone', icon: '⬜', blurb: 'Dug from deep pits. Sturdy building material.', placeable: true },
  { id: 'wood', name: 'Wood', icon: '🪵', blurb: 'Chopped from pines and oaks.', placeable: false },
  { id: 'copper', name: 'Copper', icon: '🟧', blurb: 'Smelted from orange veins.', placeable: false },
  { id: 'iron', name: 'Iron', icon: '⬛', blurb: 'Smelted from blue-grey veins.', placeable: false },
  { id: 'gold', name: 'Gold', icon: '🟨', blurb: 'Rare veins glitter in the hills.', placeable: false },
];

const SAVE_KEY = 'babylon-openworld-inventory-v1';

export type ToolMode = 'mine' | 'build';

export interface InventoryRefs {
  add(id: ItemId, n: number): void;
  remove(id: ItemId, n: number): boolean;
  count(id: ItemId): number;
  selectedPlaceable(): ItemId | null;
  setSelected(id: ItemId): void;
  mode: ToolMode;
  setMode(m: ToolMode): void;
  onChange(cb: () => void): void;
  toast(msg: string): void;
}

export function buildInventory(): InventoryRefs {
  const counts: Record<ItemId, number> = { dirt: 0, stone: 0, wood: 0, copper: 0, iron: 0, gold: 0 };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<ItemId, number>>;
      for (const it of ITEMS) if (typeof parsed[it.id] === 'number') counts[it.id] = Math.max(0, Math.floor(parsed[it.id] as number));
    }
  } catch { /* fresh save */ }

  // Give first-time players a starter kit so Build mode is tryable immediately
  if (Object.values(counts).every((v) => v === 0)) {
    counts.dirt = 12;
  }

  let selected: ItemId = 'dirt';
  let mode: ToolMode = 'mine';
  const listeners = new Set<() => void>();
  const save = () => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(counts)); } catch { /* private mode */ }
  };

  // ---------- DOM ----------
  const hotbar = document.getElementById('hotbar')!;
  const panel = document.getElementById('inv-panel')!;
  const grid = document.getElementById('inv-grid')!;
  const bagBtn = document.getElementById('bag-btn')!;
  const modeBtn = document.getElementById('mode-btn')!;
  const toasts = document.getElementById('toasts')!;

  const slotEls = new Map<ItemId, HTMLElement>();
  for (const def of ITEMS) {
    const el = document.createElement('button');
    el.className = 'slot';
    el.dataset.item = def.id;
    el.title = def.name;
    el.innerHTML = `<span class="slot-icon">${def.icon}</span><span class="slot-count">0</span><span class="slot-key">${ITEMS.indexOf(def) + 1}</span>`;
    el.addEventListener('click', () => {
      if (def.placeable) { selected = def.id; if (mode !== 'build') setMode('build'); }
      else toast(`${def.icon} ${def.name} — resource, not buildable`);
      render();
    });
    hotbar.appendChild(el);
    slotEls.set(def.id, el);

    const card = document.createElement('div');
    card.className = 'inv-card';
    card.dataset.item = def.id;
    card.innerHTML = `<div class="inv-icon">${def.icon}</div><div class="inv-name">${def.name}</div><div class="inv-count">×0</div><div class="inv-blurb">${def.blurb}</div>`;
    grid.appendChild(card);
  }

  function toast(msg: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    toasts.appendChild(el);
    while (toasts.children.length > 4) toasts.firstChild?.remove();
    setTimeout(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 2200);
  }

  function render(): void {
    for (const def of ITEMS) {
      const slot = slotEls.get(def.id)!;
      slot.querySelector('.slot-count')!.textContent = `×${counts[def.id]}`;
      slot.classList.toggle('selected', mode === 'build' && selected === def.id && def.placeable);
      slot.classList.toggle('locked', !def.placeable);
      slot.classList.toggle('empty', counts[def.id] <= 0 && def.placeable);
    }
    for (const card of Array.from(grid.children) as HTMLElement[]) {
      const id = card.dataset.item as ItemId;
      card.querySelector('.inv-count')!.textContent = `×${counts[id]}`;
    }
    modeBtn.textContent = mode === 'mine' ? '⛏ Mine' : '🧱 Build';
    modeBtn.classList.toggle('build', mode === 'build');
    for (const cb of listeners) cb();
  }

  bagBtn.addEventListener('click', () => panel.classList.toggle('open'));
  document.getElementById('inv-close')?.addEventListener('click', () => panel.classList.remove('open'));
  modeBtn.addEventListener('click', () => setMode(mode === 'mine' ? 'build' : 'mine'));

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') panel.classList.toggle('open');
    if (e.code === 'KeyB') setMode(mode === 'mine' ? 'build' : 'mine');
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
    if (n >= 0 && n < ITEMS.length) {
      const def = ITEMS[n];
      if (def.placeable) { selected = def.id; setMode('build'); }
    }
    if (e.code === 'KeyF') (window as any).__mineAtCrosshair?.();
  });

  function setMode(m: ToolMode): void {
    mode = m;
    render();
  }

  const refs: InventoryRefs = {
    add(id, n) { counts[id] = Math.max(0, counts[id] + n); save(); render(); },
    remove(id, n) {
      if (counts[id] < n) return false;
      counts[id] -= n; save(); render();
      return true;
    },
    count: (id) => counts[id],
    selectedPlaceable: () => (mode === 'build' && counts[selected] > 0 ? selected : null),
    setSelected: (id) => { selected = id; render(); },
    get mode() { return mode; },
    setMode,
    onChange(cb) { listeners.add(cb); },
    toast,
  };
  render();
  return refs;
}
