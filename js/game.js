/* 나래 짝꿍 카드 — 게임 진행 */
(function () {
  const DATA = window.GAME_DATA;
  const $ = s => document.querySelector(s);
  const { won, num, makeMoney, compose } = window.Money;
  const store = Voice.store;

  const settings = {
    countOnMatch: store.get('countOnMatch', true),
    use500: store.get('use500', false),
    sfx: store.get('sfx', true)
  };

  const state = {
    mode: 1,
    pairs: store.get('pairs', 4),
    layout: store.get('layout', 'open'),   // open: 펼쳐 놓기, flip: 뒤집어 놓기
    cards: [], sel: null, found: [], wrong: 0, busy: false,
    round: 0, first: true
  };

  /* ---------- 효과음 (파일 없이 즉석 합성) ---------- */
  let actx = null;
  function tone(freq, dur, when = 0, type = 'sine', vol = .18) {
    if (!settings.sfx) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime + when;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + .015);
      g.gain.exponentialRampToValueAtTime(.001, t + dur);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + dur + .05);
    } catch (e) { /* 효과음 없이 진행 */ }
  }
  const sfx = {
    tap() { tone(880, .09, 0, 'triangle', .12); },
    flip() { tone(660, .07, 0, 'triangle', .1); tone(990, .07, .06, 'triangle', .08); },
    back() { tone(520, .09, 0, 'triangle', .1); },
    good() { [523, 659, 784, 1047].forEach((f, i) => tone(f, .25, i * .1, 'triangle')); },
    bad() { tone(260, .18, 0, 'square', .06); tone(200, .25, .16, 'square', .06); }
  };

  /* ---------- 도우미 ---------- */
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const restart = el => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };

  const screens = ['Start', 'Board', 'Finish'];
  function show(name) {
    screens.forEach(s => { $('#screen' + s).hidden = s !== name; });
    $('#stamps').style.visibility = name === 'Start' ? 'hidden' : 'visible';
  }

  function renderStamps() {
    const box = $('#stamps');
    box.innerHTML = '';
    for (let i = 0; i < state.pairs; i++) {
      const s = document.createElement('div');
      const on = i < state.found.length;
      s.className = 'stamp' + (on ? ' on' : '');
      s.textContent = on ? '⭐' : '';
      box.appendChild(s);
    }
  }

  function toast(text, kind) {
    const t = $('#toast');
    t.textContent = text;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.className = 'toast'; }, 2000);
  }

  function confetti(n = 24) {
    const fx = $('#fx');
    const pieces = ['⭐', '🎉', '💰', '💛', '✨', '🃏'];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.textContent = pieces[i % pieces.length];
      c.style.left = Math.random() * 100 + 'vw';
      c.style.animationDuration = 1.6 + Math.random() * 1.4 + 's';
      c.style.animationDelay = Math.random() * .4 + 's';
      fx.appendChild(c);
      setTimeout(() => c.remove(), 3600);
    }
  }

  /** 돈 묶음 그림: 지폐는 한 줄에 5장까지 겹쳐서, 동전은 한 줄에 5개씩 */
  function makePile(values) {
    const pile = document.createElement('span');
    pile.className = 'pile';
    const groups = [['bills', values.filter(v => v >= 1000)], ['coins', values.filter(v => v < 1000)]];
    groups.forEach(([kind, list]) => {
      for (let i = 0; i < list.length; i += 5) {
        const row = document.createElement('span');
        row.className = 'row ' + kind;
        list.slice(i, i + 5).forEach((v, j, arr) => {
          const m = makeMoney(v, false);
          m.style.zIndex = arr.length - j; // 앞의 지폐가 위로: 겹쳐도 금액 글자가 보임
          row.appendChild(m);
        });
        pile.appendChild(row);
      }
    });
    return pile;
  }

  /** 카드 크기에 맞게 돈 그림 크기 맞추기 */
  function fitPile(card) {
    const face = card.el.querySelector('.front');
    const pile = face.querySelector('.pile');
    if (!pile) return;
    const W = face.clientWidth * .92, H = (face.clientHeight - parseFloat(getComputedStyle(face).paddingTop)) * .9;
    let fs = Math.max(4, face.clientHeight / 11);
    pile.style.fontSize = fs + 'px';
    const r = Math.min(W / pile.offsetWidth, H / pile.offsetHeight, 1);
    fs *= r;
    pile.style.fontSize = fs + 'px';
    for (let k = 0; k < 20 && (pile.offsetWidth > W || pile.offsetHeight > H) && fs > 3; k++) {
      fs *= .94; pile.style.fontSize = fs + 'px';
    }
  }
  const fitAll = () => state.cards.forEach(c => c.kind === 'money' && fitPile(c));
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitAll, 150); });

  /* ---------- 짝꿍 만들기 ---------- */
  function makePairs() {
    const n = state.pairs;
    const opts = { use500: state.mode !== 1 && settings.use500 };
    let list = [];
    if (state.mode === 1) {
      list = shuffle([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]).slice(0, n).map(a => ({ amount: a }));
    } else if (state.mode === 2) {
      const used = new Set();
      while (list.length < n) {
        const a = (1 + Math.floor(Math.random() * 9)) * 1000 + (1 + Math.floor(Math.random() * 9)) * 100;
        if (!used.has(a)) { used.add(a); list.push({ amount: a }); }
      }
    } else {
      const used = new Set();
      for (const p of shuffle(DATA.level1.concat(DATA.level2))) {
        if (list.length >= n) break;
        if (!used.has(p.price)) { used.add(p.price); list.push({ amount: p.price, item: p }); }
      }
    }
    const cards = [];
    list.forEach((p, i) => {
      let coins = compose(p.amount, opts);
      // 카드가 작은 6쌍 판에서는 돈 개수가 너무 많지 않게(오천 원 지폐를 더 자주) 다시 뽑습니다
      for (let k = 0; k < 4 && state.pairs >= 6 && coins.length > 9; k++) coins = compose(p.amount, opts);
      cards.push({ pair: i, kind: 'money', amount: p.amount, coins: coins.sort((a, b) => b - a) });
      cards.push(p.item ? { pair: i, kind: 'item', amount: p.amount, item: p.item } : { pair: i, kind: 'amount', amount: p.amount });
    });
    return shuffle(cards);
  }

  /** 카드를 눌렀을 때 읽어 줄 문장 */
  function cardVoice(c) {
    if (c.kind === 'money') return ['money_tap'];
    if (c.kind === 'item') return [c.item.id];
    return ['w-' + c.amount];
  }

  function fillFront(face, c) {
    const chip = { money: '💰 돈', amount: '🏷️ 금액', item: '🛍️ 물건' }[c.kind];
    face.innerHTML = `<span class="chip">${chip}</span>`;
    if (c.kind === 'money') {
      face.appendChild(makePile(c.coins));
    } else if (c.kind === 'amount') {
      face.insertAdjacentHTML('beforeend', `<span class="amt"><b>${num(c.amount)}</b><small>${won(c.amount)}</small></span>`);
    } else {
      const p = c.item;
      face.insertAdjacentHTML('beforeend', `<span class="item-emoji">${p.emoji}</span><span class="item-name">${p.name}</span><span class="tag"><b>${num(p.price)}</b><small>${p.priceText}</small></span>`);
    }
  }

  function cardLabel(c) {
    if (c.kind === 'money') return '돈 카드';
    if (c.kind === 'item') return c.item.say;
    return won(c.amount) + ' 카드';
  }

  /* ---------- 놀이판 ---------- */
  function guideId() { return state.mode === 3 ? 'guide_open_3' : 'guide_open'; }

  async function startBoard() {
    state.round++;
    const my = state.round;
    state.cards = makePairs();
    state.sel = null; state.found = []; state.wrong = 0; state.busy = false;
    renderStamps();

    const flip = state.layout === 'flip';
    $('#boardTitle').textContent = state.mode === 3 ? '💰 돈 카드와 값이 같은 🛍️ 물건 카드를 찾아요' : '💰 돈 카드와 값이 같은 🏷️ 금액 카드를 찾아요';
    $('#btnPeek').hidden = !flip;

    const board = $('#board');
    board.innerHTML = '';
    board.className = 'board n' + state.cards.length;
    state.cards.forEach((c, i) => {
      const el = document.createElement('button');
      el.className = 'card k-' + c.kind;
      el.style.animationDelay = i * 0.04 + 's';
      el.innerHTML = '<span class="inner"><span class="face front"></span><span class="face back"><b>?</b><small>눌러서 뒤집기</small></span></span>';
      fillFront(el.querySelector('.front'), c);
      el.setAttribute('aria-label', flip ? '뒤집힌 카드' : cardLabel(c));
      el.addEventListener('click', () => tapCard(i));
      c.el = el;
      board.appendChild(el);
    });
    show('Board');
    requestAnimationFrame(fitAll);

    const intro = state.first ? ['welcome'] : [];
    state.first = false;
    if (!flip) { Voice.play(intro.concat(guideId())); return; }

    // 뒤집기 놀이: 처음에 잠깐 보여 준 뒤 뒤집습니다
    state.busy = true;
    await Promise.all([Voice.play(intro.concat('guide_preview')), wait(3500)]);
    await wait(1200);
    if (my !== state.round) return;
    state.cards.forEach(c => { c.el.classList.add('down'); c.el.setAttribute('aria-label', '뒤집힌 카드'); });
    sfx.flip();
    state.busy = false;
    Voice.play('guide_flip');
  }

  function reveal(c) {
    if (c.el.classList.contains('down')) { c.el.classList.remove('down'); sfx.flip(); }
    c.el.setAttribute('aria-label', cardLabel(c));
  }
  function hide(c) {
    if (state.layout !== 'flip' || c.done) return;
    c.el.classList.add('down');
    c.el.setAttribute('aria-label', '뒤집힌 카드');
  }

  async function tapCard(i) {
    const c = state.cards[i];
    if (state.busy || c.done) return;

    if (state.sel === i) {                       // 같은 카드를 다시 누름
      if (state.layout === 'open') { sfx.back(); c.el.classList.remove('sel'); state.sel = null; }
      else Voice.play(cardVoice(c));
      return;
    }
    if (state.layout === 'open') sfx.tap();
    reveal(c);
    c.el.classList.add('sel');

    if (state.sel === null) { state.sel = i; Voice.play(cardVoice(c)); return; }

    const a = state.cards[state.sel];
    state.sel = null;
    if (a.pair === c.pair) await matched(a, c);
    else await mismatch(a, c);
  }

  async function matched(a, c) {
    const my = state.round;
    state.busy = true;
    state.wrong = 0;
    const no = state.found.length + 1;
    [a, c].forEach(x => {
      x.done = true;
      x.el.classList.remove('sel');
      x.el.classList.add('done');
      x.el.querySelector('.front').insertAdjacentHTML('beforeend', `<span class="badge">✔ ${no}</span>`);
    });
    state.found.push({ money: a.kind === 'money' ? a : c, other: a.kind === 'money' ? c : a });
    renderStamps();
    sfx.good(); confetti(16);
    toast('딩동댕! 짝꿍이에요 ⭐', 'good');
    const ids = (c.kind === 'money' ? [] : cardVoice(c)).concat(pick(['match_1', 'match_2', 'match_3']));
    await Voice.play(ids);
    if (my !== state.round) return;
    if (settings.countOnMatch) {
      await countMoney(a.kind === 'money' ? a : c, false);
      if (my !== state.round) return;
    }
    await wait(400);
    if (my !== state.round) return;
    state.busy = false;
    if (state.found.length >= state.pairs) finish();
  }

  async function mismatch(a, c) {
    const my = state.round;
    state.busy = true;
    state.wrong++;
    sfx.bad();
    [a, c].forEach(x => x.el.classList.add('no'));
    toast('값이 달라요', 'bad');
    const ids = (c.kind === 'money' ? [] : cardVoice(c)).concat('nomatch');
    if (state.wrong >= 2) ids.push('hint_offer');
    Voice.play(ids);   // 음성은 계속 나오고, 카드는 잠시 뒤 바로 다시 고를 수 있게
    await wait(state.layout === 'flip' ? 2000 : 1300);
    if (my !== state.round) return;
    [a, c].forEach(x => { x.el.classList.remove('no', 'sel'); hide(x); });
    state.busy = false;
    if (state.wrong >= 2) restart($('#btnCount'));
  }

  /** 돈 카드의 돈을 하나씩 짚으며 "천, 이천, 이천 백 … 모두 ○○ 원이에요" */
  async function countMoney(c, intro = true) {
    const my = state.round;
    const face = c.el.querySelector('.front');
    const els = [...face.querySelectorAll('.pile .money')];
    const was = state.busy;
    state.busy = true;
    if (intro) await Voice.play('count_together', false);
    let run = 0;
    const bub = document.createElement('span');
    bub.className = 'run';
    for (let i = 0; i < els.length; i++) {
      if (my !== state.round) return;
      run += c.coins[i];
      els[i].classList.add('counting');
      bub.textContent = num(run);
      if (!bub.parentNode) face.appendChild(bub);
      tone(600 + i * 40, .12, 0, 'triangle', .1);
      await Promise.all([Voice.play('n-' + run, false), wait(650)]);
      els[i].classList.remove('counting');
    }
    if (my !== state.round) return;
    await Voice.play('sum-' + run, false);
    setTimeout(() => bub.remove(), 1500);
    state.busy = was;
  }

  async function onCount() {
    if (state.busy) return;
    const c = state.sel !== null ? state.cards[state.sel] : null;
    if (!c || c.kind !== 'money') { Voice.play('count_need_money'); return; }
    await countMoney(c, true);
  }

  async function peek() {
    if (state.busy || state.layout !== 'flip') return;
    const my = state.round;
    state.busy = true;
    const hidden = state.cards.filter(c => !c.done && c.el.classList.contains('down'));
    hidden.forEach(c => c.el.classList.remove('down'));
    sfx.flip();
    await Promise.all([Voice.play('peek', false), wait(3000)]);
    if (my !== state.round) return;
    hidden.forEach(c => { if (state.cards.indexOf(c) !== state.sel) c.el.classList.add('down'); });
    sfx.flip();
    state.busy = false;
  }

  /* ---------- 끝: 짝꿍 앨범 ---------- */
  function finish() {
    const album = $('#album');
    album.innerHTML = '';
    state.found.forEach(f => {
      const row = document.createElement('div');
      row.className = 'album-item';
      row.appendChild(makePile(f.money.coins));
      row.insertAdjacentHTML('beforeend', '<span class="eq">=</span>');
      if (f.other.kind === 'item') {
        const p = f.other.item;
        row.insertAdjacentHTML('beforeend', `<span class="ae">${p.emoji}</span><span class="amt"><b>${num(p.price)}</b><small>${p.name}</small></span>`);
      } else {
        row.insertAdjacentHTML('beforeend', `<span class="amt"><b>${num(f.other.amount)}</b><small>${won(f.other.amount)}</small></span>`);
      }
      album.appendChild(row);
    });
    $('#finishMsg').textContent = `짝꿍 ${state.found.length}쌍을 찾았어요. 정말 잘했어요!`;
    show('Finish');
    confetti(30); sfx.good();
    Voice.play('finish');
  }

  /* ---------- 설정 ---------- */
  function fillVoices() {
    const sel = $('#setVoice');
    const list = Voice.list();
    sel.innerHTML = '';
    if (Voice.usesClips()) {
      sel.innerHTML = '<option>녹음된 음성 파일 사용 중</option>';
      sel.disabled = true;
    } else if (!list.length) {
      sel.innerHTML = '<option>한국어 음성 없음</option>';
      sel.disabled = true;
    } else {
      sel.disabled = false;
      list.forEach(v => {
        const o = document.createElement('option');
        o.value = v.name;
        o.textContent = v.name + (/natural|neural|google/i.test(v.name) ? '  ★자연스러움' : '');
        if (Voice.current() && v.name === Voice.current().name) o.selected = true;
        sel.appendChild(o);
      });
    }
    $('#voiceInfo').textContent = Voice.describe();
  }
  Voice.onVoicesChanged = fillVoices;

  function openSettings() {
    fillVoices();
    $('#setRate').value = Voice.rate;
    $('#rateOut').textContent = Voice.rate.toFixed(2) + '배';
    $('#setCount').checked = settings.countOnMatch;
    $('#set500').checked = settings.use500;
    $('#setSfx').checked = settings.sfx;
    $('#settings').showModal();
  }

  /* ---------- 이벤트 연결 ---------- */
  function goStart() { state.round++; Voice.stop(); state.busy = false; show('Start'); }

  document.querySelectorAll('.mode-card').forEach(b => b.addEventListener('click', () => {
    sfx.tap(); state.mode = +b.dataset.mode; startBoard();
  }));
  function bindSeg(id, key, attr, parse) {
    document.querySelectorAll(id + ' button').forEach(b => {
      b.classList.toggle('on', parse(b.dataset[attr]) === state[key]);
      b.addEventListener('click', () => {
        state[key] = parse(b.dataset[attr]); store.set(key, state[key]);
        document.querySelectorAll(id + ' button').forEach(x => x.classList.toggle('on', x === b));
        sfx.tap();
      });
    });
  }
  bindSeg('#pairSeg', 'pairs', 'pairs', Number);
  bindSeg('#layoutSeg', 'layout', 'layout', String);

  $('#btnHome').addEventListener('click', goStart);
  $('#btnRepeat').addEventListener('click', () => Voice.repeat());
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnFull').addEventListener('click', () => {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
  });
  $('#btnCount').addEventListener('click', onCount);
  $('#btnPeek').addEventListener('click', peek);
  $('#btnNew').addEventListener('click', () => { Voice.stop(); startBoard(); });
  $('#btnAgain').addEventListener('click', startBoard);
  $('#btnToStart').addEventListener('click', goStart);

  $('#setVoice').addEventListener('change', e => { Voice.setVoice(e.target.value); $('#voiceInfo').textContent = Voice.describe(); Voice.play('welcome', false); });
  $('#setRate').addEventListener('input', e => { Voice.setRate(+e.target.value); $('#rateOut').textContent = (+e.target.value).toFixed(2) + '배'; });
  $('#setCount').addEventListener('change', e => { settings.countOnMatch = e.target.checked; store.set('countOnMatch', settings.countOnMatch); });
  $('#set500').addEventListener('change', e => { settings.use500 = e.target.checked; store.set('use500', settings.use500); });
  $('#setSfx').addEventListener('change', e => { settings.sfx = e.target.checked; store.set('sfx', settings.sfx); });
  $('#btnVoiceTest').addEventListener('click', () => Voice.play(['welcome', 'w-3200'], false));

  // 전자칠판: 길게 눌러 생기는 메뉴·확대 방지
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  show('Start');
})();
