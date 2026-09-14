export interface InputState {
  moveX: number; // -1..1 strafe
  moveZ: number; // -1..1 forward
  jump: boolean; // edge-triggered, consumed by player
  sprint: boolean;
  lookDX: number; // accumulated pixels, consumed by camera
  lookDY: number;
  zoom: number; // wheel accumulation
}

export function createInput(): InputState {
  return { moveX: 0, moveZ: 0, jump: false, sprint: false, lookDX: 0, lookDY: 0, zoom: 0 };
}

export function bindKeyboard(input: InputState): () => void {
  const keys = new Set<string>();
  const keyHandler = (down: boolean) => (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k === ' ' ? ' ' : k)) e.preventDefault();
    if (down) {
      keys.add(k);
      if (k === ' ' && !e.repeat) input.jump = true;
    } else {
      keys.delete(k);
    }
    // recompute
    const left = keys.has('a') || keys.has('arrowleft');
    const right = keys.has('d') || keys.has('arrowright');
    const fwd = keys.has('w') || keys.has('arrowup');
    const back = keys.has('s') || keys.has('arrowdown');
    input.moveX = (right ? 1 : 0) - (left ? 1 : 0);
    input.moveZ = (fwd ? 1 : 0) - (back ? 1 : 0);
    input.sprint = keys.has('shift');
  };
  const dn = keyHandler(true);
  const up = keyHandler(false);
  window.addEventListener('keydown', dn);
  window.addEventListener('keyup', up);
  return () => {
    window.removeEventListener('keydown', dn);
    window.removeEventListener('keyup', up);
  };
}

/** Desktop mouse look: drag on canvas to orbit, wheel to zoom. */
export function bindMouseLook(canvas: HTMLElement, input: InputState): () => void {
  let dragging = false;
  let lx = 0;
  let ly = 0;
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return; // touch handled separately
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging || e.pointerType === 'touch') return;
    input.lookDX += e.clientX - lx;
    input.lookDY += e.clientY - ly;
    lx = e.clientX;
    ly = e.clientY;
  };
  const up = () => { dragging = false; };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    input.zoom += Math.sign(e.deltaY);
  };
  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    canvas.removeEventListener('wheel', wheel);
  };
}

export interface TouchHandles {
  joystickVec: { x: number; y: number };
  setJoystickVisible: (v: boolean) => void;
}

/** Mobile: left joystick drives moveX/moveZ, right-half drag orbits, buttons jump/sprint. */
export function bindTouch(input: InputState): TouchHandles {
  const joy = document.getElementById('joystick')!;
  const stick = document.getElementById('stick')!;
  const btnJump = document.getElementById('btn-jump')!;
  const btnSprint = document.getElementById('btn-sprint')!;
  const vec = { x: 0, y: 0 };
  let joyId: number | null = null;
  let joyCX = 0;
  let joyCY = 0;

  const R = 44; // max stick travel px

  const joyStart = (e: PointerEvent) => {
    joyId = e.pointerId;
    const r = joy.getBoundingClientRect();
    joyCX = r.left + r.width / 2;
    joyCY = r.top + r.height / 2;
    joy.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const joyMove = (e: PointerEvent) => {
    if (e.pointerId !== joyId) return;
    let dx = e.clientX - joyCX;
    let dy = e.clientY - joyCY;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    vec.x = dx / R;
    vec.y = dy / R;
    // joystick up = forward
    input.moveX = vec.x;
    input.moveZ = -vec.y;
    e.preventDefault();
  };
  const joyEnd = (e: PointerEvent) => {
    if (e.pointerId !== joyId) return;
    joyId = null;
    vec.x = 0; vec.y = 0;
    stick.style.transform = 'translate(-50%,-50%)';
    input.moveX = 0; input.moveZ = 0;
  };

  joy.addEventListener('pointerdown', joyStart);
  joy.addEventListener('pointermove', joyMove);
  joy.addEventListener('pointerup', joyEnd);
  joy.addEventListener('pointercancel', joyEnd);

  // Right-half look (any touch starting on right 55% of screen, excluding buttons)
  let lookId: number | null = null;
  let lx = 0;
  let ly = 0;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const t = e.target as HTMLElement;
    if (joy.contains(t) || btnJump.contains(t) || btnSprint.contains(t)) return;
    if (t.closest?.('#hud-buttons') || t.closest?.('#help-modal')) return;
    if (e.clientX < window.innerWidth * 0.4) return; // left side reserved
    if (lookId !== null) return;
    lookId = e.pointerId;
    lx = e.clientX; ly = e.clientY;
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== lookId) return;
    input.lookDX += (e.clientX - lx) * 1.6;
    input.lookDY += (e.clientY - ly) * 1.6;
    lx = e.clientX; ly = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId === lookId) lookId = null;
  };
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  const jDown = (e: PointerEvent) => { e.preventDefault(); input.jump = true; btnJump.classList.add('active'); };
  const jUp = () => btnJump.classList.remove('active');
  const sDown = (e: PointerEvent) => { e.preventDefault(); input.sprint = true; btnSprint.classList.add('active'); };
  const sUp = () => { input.sprint = false; btnSprint.classList.remove('active'); };
  btnJump.addEventListener('pointerdown', jDown);
  btnJump.addEventListener('pointerup', jUp);
  btnJump.addEventListener('pointerleave', jUp);
  btnSprint.addEventListener('pointerdown', sDown);
  btnSprint.addEventListener('pointerup', sUp);
  btnSprint.addEventListener('pointerleave', sUp);

  return {
    joystickVec: vec,
    setJoystickVisible: (v: boolean) => {
      document.getElementById('touch-ui')?.classList.toggle('hidden', !v);
    },
  };
}
