// Two virtual FTC gamepads fed by the keyboard (remappable) and by physical controllers (Gamepad API).
import { get, log, send } from './store';

export const AXES = [['lx-', 'Left stick left'], ['lx+', 'Left stick right'], ['ly-', 'Left stick up'], ['ly+', 'Left stick down'],
  ['rx-', 'Right stick left'], ['rx+', 'Right stick right'], ['ry-', 'Right stick up'], ['ry+', 'Right stick down'], ['lt', 'Left trigger'], ['rt', 'Right trigger']] as const;
export const BUTTONS = ['a', 'b', 'x', 'y', 'left_bumper', 'right_bumper', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'left_stick_button', 'right_stick_button', 'back', 'start', 'guide'] as const;
export type Bindings = Record<string, string>; // action -> KeyboardEvent.code

export const DEFAULT_BINDINGS: Record<1 | 2, Bindings> = {
  1: { 'lx-': 'KeyA', 'lx+': 'KeyD', 'ly-': 'KeyW', 'ly+': 'KeyS', 'rx-': 'ArrowLeft', 'rx+': 'ArrowRight', 'ry-': 'ArrowUp', 'ry+': 'ArrowDown',
    lt: 'KeyQ', rt: 'KeyE', left_bumper: 'KeyC', right_bumper: 'KeyF', a: 'KeyJ', b: 'KeyK', x: 'KeyU', y: 'KeyI',
    dpad_up: 'Digit1', dpad_down: 'Digit2', dpad_left: 'Digit3', dpad_right: 'Digit4' },
  2: {}, // gamepad 2 has no keys until you assign some (or plug in a second controller)
};

export type PadState = { lx: number; ly: number; rx: number; ry: number; lt: number; rt: number; buttons: Record<string, boolean>; source: string };
const empty = (): PadState => ({ lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: {}, source: 'keyboard' });
export const pads: Record<1 | 2, PadState> = { 1: empty(), 2: empty() };
export const keysDown = new Set<string>();

// ---- physical controllers. Each virtual gamepad has a slot holding the browser's index of the controller assigned to it.
export const slots: Record<1 | 2, number | null> = { 1: null, 2: null };
export const connectedPads = () => [...(navigator.getGamepads?.() ?? [])].filter((p) => p && p.connected) as Gamepad[];
export const padName = (g: Gamepad) => g.id.replace(/\s*\((STANDARD GAMEPAD\s*)?Vendor:.*\)/i, '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Controller';
export const anyButton = (g: Gamepad) => g.buttons.some((b) => b.pressed);
const remembered = (): Record<string, string | null> => get().settings?.controllers ?? {};
/** Give a controller (by browser index) to gamepad 1 or 2, or pass null to hand that gamepad back to the keyboard. Remembered for next time. */
export function assignController(pad: 1 | 2, index: number | null) {
  const other = pad === 1 ? 2 : 1;
  if (index != null && slots[other] === index) slots[other] = slots[pad]; // taking the other gamepad's controller swaps the two
  slots[pad] = index;
  const id = (p: 1 | 2) => connectedPads().find((g) => g.index === slots[p])?.id ?? null;
  send({ type: 'saveSettings', settings: { controllers: { 1: id(1), 2: id(2) } } });
}
export function swapControllers() { const a = slots[1]; slots[1] = slots[2]; slots[2] = a; assignController(1, slots[1]); }
let suspended = false, askSetup: (() => void) | null = null;
/** While the setup dialog is open the robot gets neutral gamepads, so button presses made to set up do not drive it. */
export const suspendInput = (on: boolean) => { suspended = on; };
/** Called when a controller that has not been set up before is plugged in (or wakes up). */
export const onControllerSetupNeeded = (cb: (() => void) | null) => { askSetup = cb; };
const seen = new Map<number, string>(); let lastCombo = 0;
function watchControllers() {
  const list = connectedPads(), mem = remembered();
  for (const [index, name] of seen) if (!list.some((g) => g.index === index)) { // unplugged
    seen.delete(index);
    for (const p of [1, 2] as const) if (slots[p] === index) { slots[p] = null; log('warning', `Gamepad ${p}'s controller (${name}) disconnected. Gamepad ${p} is back on the keyboard.`); }
  }
  for (const g of list) {
    if (!seen.has(g.index)) { // newly connected: a controller set up before goes straight back to its gamepad
      seen.set(g.index, padName(g));
      const back = ([1, 2] as const).find((p) => slots[p] == null && mem[p] === g.id);
      if (back) { slots[back] = g.index; log('ok', `${padName(g)} connected as gamepad ${back}.`); } else askSetup?.();
    }
    // the Driver Station habit: Start + A makes this controller gamepad 1, Start + B gamepad 2
    const combo = g.buttons[9]?.pressed ? (g.buttons[0]?.pressed ? 1 : g.buttons[1]?.pressed ? 2 : 0) : 0;
    if (combo && slots[combo as 1 | 2] !== g.index && performance.now() - lastCombo > 500) { lastCombo = performance.now(); assignController(combo as 1 | 2, g.index); log('ok', `${padName(g)} is now gamepad ${combo} (Start + ${combo === 1 ? 'A' : 'B'}).`); }
  }
}

export function bindings(pad: 1 | 2): Bindings {
  return get().settings?.keyBindings?.[pad] ?? DEFAULT_BINDINGS[pad];
}
export function saveBindings(pad: 1 | 2, b: Bindings) {
  const all = { 1: bindings(1), 2: bindings(2), [pad]: b };
  send({ type: 'saveSettings', settings: { keyBindings: all } });
}
export const keyLabel = (code?: string) => (code ? code.replace(/^Key|^Digit/, '').replace('Arrow', 'Arrow ') : '—');

const typing = () => { const el = document.activeElement as HTMLElement | null; return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable || !!el.closest('.monaco-editor')); };
let capture: ((code: string) => void) | null = null;
/** The next key pressed is handed to cb instead of driving a gamepad (used by the remapping dialog). */
export const captureNextKey = (cb: ((code: string) => void) | null) => { capture = cb; };

addEventListener('keydown', (e) => {
  if (capture) { e.preventDefault(); const cb = capture; capture = null; cb(e.code); return; }
  if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
  const used = [1, 2].some((p) => Object.values(bindings(p as 1 | 2)).includes(e.code));
  if (used) { keysDown.add(e.code); e.preventDefault(); }
});
addEventListener('keyup', (e) => keysDown.delete(e.code));
addEventListener('blur', () => keysDown.clear());

function read(pad: 1 | 2): PadState {
  const b = bindings(pad), k = (a: string) => (b[a] && keysDown.has(b[a]) ? 1 : 0);
  const st: PadState = { lx: k('lx+') - k('lx-'), ly: k('ly+') - k('ly-'), rx: k('rx+') - k('rx-'), ry: k('ry+') - k('ry-'), lt: k('lt'), rt: k('rt'), buttons: {}, source: Object.keys(b).length ? 'keyboard' : 'no keys assigned' };
  for (const n of BUTTONS) if (k(n)) st.buttons[n] = true;
  const keyActive = Object.values(b).some((c) => keysDown.has(c));
  const gp = slots[pad] == null ? null : connectedPads().find((g) => g.index === slots[pad]);
  if (gp && !keyActive) {
    const dz = (v: number) => (Math.abs(v) < 0.06 ? 0 : v), B = (i: number) => !!gp.buttons[i]?.pressed;
    return { lx: dz(gp.axes[0]), ly: dz(gp.axes[1]), rx: dz(gp.axes[2]), ry: dz(gp.axes[3]), lt: gp.buttons[6]?.value ?? 0, rt: gp.buttons[7]?.value ?? 0,
      buttons: { a: B(0), b: B(1), x: B(2), y: B(3), left_bumper: B(4), right_bumper: B(5), back: B(8), start: B(9), left_stick_button: B(10), right_stick_button: B(11), dpad_up: B(12), dpad_down: B(13), dpad_left: B(14), dpad_right: B(15), guide: B(16) },
      source: padName(gp) + (gp.mapping === 'standard' ? '' : ' (unrecognised layout: check the buttons)') };
  }
  return st;
}

const last: Record<number, string> = {};
setInterval(() => {
  watchControllers();
  for (const pad of [1, 2] as const) {
    const st = read(pad);
    pads[pad] = st; // what the panel and the setup dialog show
    const { source, ...wire } = suspended ? empty() : st, key = JSON.stringify(wire);
    if (key !== last[pad]) { last[pad] = key; send({ type: 'gamepad', id: pad, state: wire }); }
  }
}, 20);
