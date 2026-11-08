// Small DOM modal (paste a share code). Keeps text input out of the canvas.
export function promptModal(opts: { title: string; text: string; placeholder: string; ok: string; validate: (v: string) => string | null }): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dt-modal';
    wrap.innerHTML = `<div class="dt-card" role="dialog" aria-modal="true"><h2></h2><p></p><textarea spellcheck="false"></textarea><div class="dt-row"><span class="dt-err"></span><button class="dt-btn ghost" data-a="cancel">Cancel</button><button class="dt-btn" data-a="ok"></button></div></div>`;
    (wrap.querySelector('h2') as HTMLElement).textContent = opts.title;
    (wrap.querySelector('p') as HTMLElement).textContent = opts.text;
    const ta = wrap.querySelector('textarea') as HTMLTextAreaElement;
    ta.placeholder = opts.placeholder;
    const err = wrap.querySelector('.dt-err') as HTMLElement;
    (wrap.querySelector('[data-a=ok]') as HTMLElement).textContent = opts.ok;
    const done = (v: string | null) => { wrap.remove(); window.removeEventListener('keydown', onKey, true); resolve(v); };
    const submit = () => {
      const e = opts.validate(ta.value);
      if (e) { err.textContent = e; return; }
      done(ta.value);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    };
    window.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (a === 'cancel' || e.target === wrap) done(null);
      if (a === 'ok') submit();
    });
    document.body.appendChild(wrap);
    setTimeout(() => ta.focus(), 30);
  });
}
