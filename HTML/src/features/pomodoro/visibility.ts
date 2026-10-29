/**
 * 番茄钟显隐开关 —— 右键 FAB 关闭后存 localStorage；习惯页可重新打开。
 * 键名 pomodoro_visible_v1（值 '0' = 关闭）。
 */
const KEY = 'pomodoro_visible_v1';

export function isPomodoroVisible(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function setPomodoroVisible(v: boolean): void {
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* noop */ }
  try { window.dispatchEvent(new CustomEvent('pomodoro-visibility', { detail: v })); } catch { /* noop */ }
}
