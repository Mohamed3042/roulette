// The Customize sheet: big picture tiles, everything applies live behind the sheet and is remembered on the device.
const SKINS = [
  { id: 'light', name: 'Light', c: '#e2b79c' }, { id: 'medium', name: 'Medium', c: '#b47c58' },
  { id: 'deep', name: 'Deep', c: '#6e4430' }, { id: 'gloves', name: 'Leather gloves', c: '#1a1512' },
];
const CROSS = [{ id: 'dot', name: 'Dot' }, { id: 'cross', name: 'Cross' }, { id: 'circle', name: 'Circle' }, { id: 'off', name: 'None' }];
const TABS = [['gun', 'Gun'], ['hands', 'Hands'], ['room', 'Room'], ['choices', 'Choices'], ['feel', 'Feel']];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createCustomize(ctx) {
  const { S } = ctx;
  const root = document.getElementById('custom'), body = root.querySelector('.c-body'), tabs = root.querySelector('.c-tabs');
  let tab = 'gun', draft = null;
  tabs.innerHTML = TABS.map(([id, name]) => `<button type="button" role="tab" data-tab="${id}">${name}</button>`).join('');
  tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { ctx.sound.uiTick(); show(b.dataset.tab); } });
  root.querySelector('.c-close').addEventListener('click', close);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  function open(which) {
    ctx.onOpen?.();
    draft = null;
    root.hidden = false;
    show(which || tab);
    window.gsap?.fromTo(root.querySelector('.c-sheet'), { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, ease: 'power3.out' });
    root.querySelector('.c-close').focus({ preventScroll: true });
  }
  function close() { commitDraft(); root.hidden = true; }
  function show(id) {
    tab = id;
    tabs.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    body.innerHTML = PANELS[id]();
    body.scrollTop = 0;
    WIRE[id]?.();
  }
  const tiles = (items, cur, kind) => `<div class="tiles ${kind}">${items.map((it) => `<button type="button" class="tile" data-pick="${it.id}" aria-pressed="${it.id === cur}">${it.img}<span class="t-name">${esc(it.name)}</span>${it.note ? `<span class="t-note">${esc(it.note)}</span>` : ''}</button>`).join('')}</div>`;
  const toggle = (k, label, on) => `<button type="button" class="toggle" data-toggle="${k}" aria-pressed="${on}"><span>${label}</span><i></i></button>`;

  const PANELS = {
    gun: () => tiles(ctx.LOOKS.map((l) => ({ ...l, img: `<img src="assets/ui/gun-${l.id}.webp" alt="" width="480" height="300" loading="lazy">` })), S.look, 'wide'),
    hands: () => tiles(SKINS.map((s) => ({ ...s, img: `<img src="assets/ui/hand-${s.id}.webp" alt="" width="300" height="300" loading="lazy" style="background:${s.c}">` })), S.skin, 'square'),
    room: () => tiles(Object.entries(ctx.ROOMS).map(([id, r]) => ({ id, name: r.name, note: r.blurb, img: `<img src="assets/plates/${id}-thumb.jpg" alt="" width="300" height="200" loading="lazy">` })), S.room, 'wide'),
    choices: () => {
      const list = draft || S.choices;
      return `<p class="c-lead">One choice per chamber, 2 to 6. The cylinder picks one at random.</p>
      <ol class="rows">${list.map((c, i) => `<li><span class="n">${i + 1}</span><input value="${esc(c)}" maxlength="24" data-row="${i}" aria-label="Choice ${i + 1}" autocomplete="off" enterkeyhint="next">
        <button type="button" class="ib" data-up="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>&#8593;</button><button type="button" class="ib" data-del="${i}" aria-label="Delete" ${list.length > 2 ? '' : 'disabled'}>&#215;</button></li>`).join('')}</ol>
      <button type="button" class="add" data-add ${list.length >= 6 ? 'disabled' : ''}>+ Add a choice</button>
      <p class="c-err" role="alert"></p>
      <div class="c-label">Quick lists</div>
      <div class="chips-row">${Object.keys(ctx.PRESETS).map((p) => `<button type="button" class="pill" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <div class="c-label">My lists</div>
      <div class="chips-row">${S.lists.map((l, i) => `<span class="saved"><button type="button" class="pill" data-list="${i}">${esc(l.name)}</button><button type="button" class="ib sm" data-unlist="${i}" aria-label="Delete list ${esc(l.name)}">&#215;</button></span>`).join('') || '<span class="c-muted">None yet.</span>'}</div>
      <div class="save-row"><input id="list-name" maxlength="20" placeholder="Name this list" autocomplete="off"><button type="button" class="btn-s" data-save>Save</button></div>
      <button type="button" class="btn-s wide" data-share>Share these choices</button>`;
    },
    feel: () => `<div class="toggles">${toggle('slowmo', 'Slow motion on the shot', S.slowmo)}${toggle('sound', 'Sound', !S.muted)}${toggle('vibrate', 'Vibration', S.vibrate)}${toggle('lefty', 'Left-handed', S.lefty)}</div>
      <div class="c-label">Crosshair</div>
      ${tiles(CROSS.map((c) => ({ ...c, img: `<span class="xh" data-style="${c.id}"><i></i></span>` })), S.crosshair, 'cross')}
      <div class="c-label">Look speed</div>
      <input type="range" class="range" min="0.4" max="2" step="0.1" value="${S.sens}" aria-label="Look speed" data-sens>
      <div class="c-label">More</div>
      <div class="chips-row"><button type="button" class="btn-s" data-fresh>Fresh paper target</button><button type="button" class="btn-s" data-coach>Show the 3 steps again</button></div>`,
  };
  const pick = (fn) => body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    ctx.sound.uiTick(); fn(b.dataset.pick);
    body.querySelectorAll('[data-pick]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  const WIRE = {
    gun: () => pick((id) => ctx.setLook(id)),
    hands: () => pick((id) => ctx.setSkin(id)),
    room: () => pick((id) => ctx.setRoom(id)),
    feel: () => {
      pick((id) => ctx.setFeel('crosshair', id));
      body.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.toggle, on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on)); ctx.sound.uiTick();
        if (k === 'sound') ctx.setFeel('muted', !on); else ctx.setFeel(k, on);
      }));
      body.querySelector('[data-sens]').addEventListener('input', (e) => ctx.setFeel('sens', +e.target.value));
      body.querySelector('[data-fresh]').addEventListener('click', () => { ctx.clearTarget(); ctx.toast('Fresh paper on the stand.'); });
      body.querySelector('[data-coach]').addEventListener('click', () => { close(); ctx.showCoach(); });
    },
    choices: () => {
      const err = body.querySelector('.c-err');
      const read = () => [...body.querySelectorAll('[data-row]')].map((i) => i.value.trim().slice(0, 24));
      const live = () => {
        draft = read();
        const ok = draft.filter(Boolean);
        err.textContent = ok.length < 2 ? 'Two choices at least.' : '';
        if (ok.length >= 2) ctx.setChoices(ok);
      };
      body.querySelectorAll('[data-row]').forEach((inp) => {
        inp.addEventListener('input', live);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const n = body.querySelector(`[data-row="${+inp.dataset.row + 1}"]`); n ? n.focus() : inp.blur(); } });
      });
      const rerender = (list) => { draft = list; show('choices'); const ok = list.filter(Boolean); if (ok.length >= 2) ctx.setChoices(ok); };
      body.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { const l = read(), i = +b.dataset.up; [l[i - 1], l[i]] = [l[i], l[i - 1]]; ctx.sound.uiTick(); rerender(l); }));
      body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { const l = read(); l.splice(+b.dataset.del, 1); ctx.sound.uiTick(); rerender(l); }));
      body.querySelector('[data-add]').addEventListener('click', () => { const l = read(); l.push(''); draft = l; show('choices'); body.querySelector(`[data-row="${l.length - 1}"]`)?.focus(); });
      body.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { ctx.sound.uiTick(); rerender(ctx.PRESETS[b.dataset.preset].slice()); ctx.toast(`Loaded ${b.dataset.preset}.`); }));
      body.querySelectorAll('[data-list]').forEach((b) => b.addEventListener('click', () => { const l = S.lists[+b.dataset.list]; ctx.sound.uiTick(); rerender(l.items.slice()); ctx.toast(`Loaded ${l.name}.`); }));
      body.querySelectorAll('[data-unlist]').forEach((b) => b.addEventListener('click', () => { const lists = S.lists.filter((_, i) => i !== +b.dataset.unlist); ctx.save('lists', lists); draft = read(); show('choices'); }));
      body.querySelector('[data-save]').addEventListener('click', () => {
        const name = body.querySelector('#list-name').value.trim().slice(0, 20), items = read().filter(Boolean);
        if (!name) { err.textContent = 'Give the list a name first.'; body.querySelector('#list-name').focus(); return; }
        if (items.length < 2) { err.textContent = 'Two choices at least.'; return; }
        const lists = S.lists.filter((l) => l.name.toLowerCase() !== name.toLowerCase()).concat({ name, items }).slice(-12);
        ctx.save('lists', lists); draft = read(); show('choices'); ctx.toast(`Saved ${name}.`);
      });
      body.querySelector('[data-share]').addEventListener('click', async () => {
        const items = read().filter(Boolean);
        const url = `${location.origin}${location.pathname}#c=${encodeURIComponent(JSON.stringify(items))}`;
        try {
          if (navigator.share && ctx.coarse) await navigator.share({ title: 'Roulette', text: 'Let the cylinder decide:', url });
          else { await navigator.clipboard.writeText(url); ctx.toast('Link copied. Send it to anyone.'); }
        } catch { /* share cancelled */ }
      });
    },
  };
  function commitDraft() { if (draft) { const ok = draft.filter(Boolean); if (ok.length >= 2) ctx.setChoices(ok); draft = null; } }
  return { open, close, isOpen: () => !root.hidden, refresh() { if (!root.hidden && tab === 'feel') show('feel'); } };
}
