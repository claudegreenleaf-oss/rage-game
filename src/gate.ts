// Entry point: a play code screen in front of the game. The game itself (./main) only loads once the
// code is right. This is a casual lock, not security: the page is static. The unlock is remembered on
// this device.
const KEY = 'dietrying.unlocked';
/** FNV-1a of the play code (the code itself isn't written in the page). */
const CODE_HASH = '43c2c0d8';

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function remembered(): boolean {
  try { return localStorage.getItem(KEY) === CODE_HASH; } catch { return false; }
}

function start(): void {
  void import('./main');
}

function ask(): void {
  const boot = document.getElementById('boot');
  if (boot) boot.style.opacity = '0';
  const wrap = document.createElement('div');
  wrap.className = 'dt-modal';
  wrap.id = 'gate';
  wrap.innerHTML = `<form class="dt-card" role="dialog" aria-modal="true" aria-labelledby="gate-title" autocomplete="off">
    <h2 id="gate-title">Die Trying</h2>
    <p>Enter the play code.</p>
    <input id="gate-code" type="password" inputmode="numeric" maxlength="12" aria-label="Play code" autofocus />
    <div class="dt-row"><span class="dt-err" aria-live="polite"></span><button class="dt-btn" type="submit">Play</button></div>
  </form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form') as HTMLFormElement;
  const input = wrap.querySelector('#gate-code') as HTMLInputElement;
  const err = wrap.querySelector('.dt-err') as HTMLElement;
  setTimeout(() => input.focus(), 30);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (fnv(input.value.trim()) !== CODE_HASH) {
      err.textContent = 'That’s not it.';
      input.value = '';
      input.focus();
      form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 220 });
      return;
    }
    try { localStorage.setItem(KEY, CODE_HASH); } catch { /* storage blocked: ask again next time */ }
    wrap.remove();
    if (boot) boot.style.opacity = '';
    start();
  });
}

if (remembered()) start(); else ask();
