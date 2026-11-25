/* 나래 짝꿍 카드 — 화폐 그림과 금액 도우미 */
(function () {
  const DIGIT = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];

  /** 3200 → "삼천 이백 원" (학습지 읽기 방식) */
  function won(n) {
    const man = Math.floor(n / 10000), th = Math.floor(n % 10000 / 1000), h = Math.floor(n % 1000 / 100);
    const parts = [];
    if (man) parts.push((man === 1 ? '' : DIGIT[man]) + '만');
    if (th) parts.push((th === 1 ? '' : DIGIT[th]) + '천');
    if (h) parts.push((h === 1 ? '' : DIGIT[h]) + '백');
    return (parts.join(' ') || '영') + ' 원';
  }
  /** 3200 → "3200원" (학습지 표기와 같게 쉼표 없이) */
  function num(n) { return n + '원'; }

  const KINDS = {
    5000: { cls: 'bill b5000', seal: '🌸', label: '오천 원' },
    1000: { cls: 'bill b1000', seal: '🌿', label: '천 원' },
    500: { cls: 'coin c500', label: '오백 원' },
    100: { cls: 'coin c100', label: '백 원' }
  };

  /** 화폐 버튼(또는 장식용 div) 만들기 */
  function makeMoney(value, asButton = true) {
    const k = KINDS[value];
    const el = document.createElement(asButton ? 'button' : 'div');
    el.className = 'money ' + k.cls;
    el.dataset.value = value;
    el.setAttribute('aria-label', k.label);
    if (value >= 1000) {
      el.innerHTML = `<span class="seal">${k.seal}</span><span class="val"><b>${value}</b><i>${k.label}</i></span>`;
    } else {
      el.innerHTML = `<b>${value}</b><i>원</i>`;
    }
    return el;
  }

  /** 금액을 화폐 묶음으로 나누기 (같은 값 찾기용 지갑) */
  function compose(amount, opts = {}) {
    const out = [];
    let th = Math.floor(amount / 1000), h = Math.floor(amount % 1000 / 100);
    if (th >= 5 && opts.use5000 !== false && Math.random() < 0.6) { out.push(5000); th -= 5; }
    for (let i = 0; i < th; i++) out.push(1000);
    if (h >= 5 && opts.use500 && Math.random() < 0.5) { out.push(500); h -= 5; }
    for (let i = 0; i < h; i++) out.push(100);
    return out;
  }

  window.Money = { won, num, makeMoney, compose, KINDS };
})();
