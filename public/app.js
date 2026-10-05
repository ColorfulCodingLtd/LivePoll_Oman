const configs = {};
let config = null;
let lang = new URLSearchParams(location.search).get('lang');
if (!['en', 'ar'].includes(lang)) { try { lang = localStorage.getItem('poll_language'); } catch {} }
if (!['en', 'ar'].includes(lang)) lang = 'en';
const isResults = location.pathname === '/results';
document.body.classList.toggle('results-page', isResults);
const main = document.querySelector('#main');
let selected = null, voted = false, ready = false, busy = false, failed = false, data = null, connected = true, started = false;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const text = key => config[key];
const html = key => esc(text(key));
const number = value => new Intl.NumberFormat(lang).format(value);
async function api(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  if (!response.ok && response.status !== 409) throw new Error('Request failed');
  return response;
}
async function loadConfig(code) {
  if (!configs[code]) {
    const response = await fetch(`/config_${code}.json`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Config failed');
    configs[code] = await response.json();
  }
  return configs[code];
}
function render() {
  document.documentElement.lang = lang;
  document.documentElement.dir = config.dir;
  document.title = text('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = text(el.dataset.i18n));
  const language = document.querySelector('#language');
  language.textContent = text('switchLanguageLabel');
  language.setAttribute('aria-label', text('switchLanguageAria'));
  if (isResults) {
    main.innerHTML = `<section class="results"><div class="eyebrow">${html('resultsEyebrow')}</div><h1>${html('resultsTitle')}</h1><p class="lead">${html('resultsLead')}</p><div class="total-votes"><span class="live-dot"></span><span id="total"></span></div><div id="cloud" class="cloud" aria-label="${html('resultsTitle')}"></div><p id="connection" class="connection" role="status"></p><aside class="qr-card"><img src="/qr-code.png" alt=""><p class="qr-caption" lang="en">Scan the QR code to vote</p><p class="qr-caption" lang="ar" dir="rtl">امسح رمز QR للتصويت</p></aside></section>`;
    updateCloud(); return;
  }
  if (voted) {
    main.innerHTML = `<section class="thank-you"><div class="thank-mark" aria-hidden="true">✓</div><div class="eyebrow">${html('recorded')}</div><h1 tabindex="-1">${html('thanks')}</h1><p class="lead">${html('thanksLead')}</p><p class="once">${html('once')}</p></section>`;
    return;
  }
  const answers = config.choices.map((choice, i) => `<label class="answer"><input type="radio" name="choice" value="${esc(choice.id)}" ${selected === choice.id ? 'checked' : ''} ${!ready || busy ? 'disabled' : ''}><span class="answer-index">${esc(number(i + 1).padStart(2, config.digitPad))}</span><span class="answer-copy"><strong>${esc(choice.title)}</strong>${choice.description ? `<small>${esc(choice.description)}</small>` : ''}</span><span class="answer-check" aria-hidden="true"></span></label>`).join('');
  main.innerHTML = `<section class="poll"><div class="eyebrow">${html('eyebrow')}</div><h1 id="question">${html('question')}</h1><p class="lead">${html('lead')}</p><form><fieldset aria-labelledby="question"><legend class="sr-only">${html('hint')}</legend><div class="answers">${answers}</div></fieldset><div class="submit-row"><p class="vote-hint">${html('hint')}</p><button class="primary-btn" ${!selected || !ready || busy ? 'disabled' : ''}>${html(busy ? 'sending' : 'submit')} <span aria-hidden="true">${html('submitArrow')}</span></button></div><p class="error" role="status">${failed ? html('error') : !ready ? html('loading') : ''}</p>${failed && !ready ? `<button type="button" id="retry" class="language">${html('retry')}</button>` : ''}</form></section>`;
  main.querySelector('form').addEventListener('change', event => { selected = event.target.value; main.querySelector('.primary-btn').disabled = !ready || busy; });
  main.querySelector('form').addEventListener('submit', submit);
  main.querySelector('#retry')?.addEventListener('click', session);
}
async function session() {
  failed = false; render();
  try { const response = await api('/api/session'); voted = (await response.json()).voted; ready = true; } catch { failed = true; }
  render();
}
async function submit(event) {
  event.preventDefault(); if (!selected || busy || !ready) return;
  busy = true; failed = false; render();
  try {
    await api('/api/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice: selected }) });
    voted = true;
  } catch { failed = true; }
  busy = false; render();
  if (voted) main.querySelector('h1').focus();
}
function updateCloud() {
  const total = document.querySelector('#total');
  if (!total) return;
  total.textContent = data ? `${number(data.total)} ${text('collected')}` : text('loading');
  document.querySelector('#connection').textContent = connected ? '' : text('offline');
  document.querySelector('.live-dot').classList.toggle('offline', !connected);
  const cloud = document.querySelector('#cloud');
  if (!data) return;
  const ids = config.choices.map(choice => choice.id);
  const max = Math.max(1, ...Object.values(data.counts));
  const sorted = [...ids].sort((a, b) => data.counts[b] - data.counts[a]);
  const positions = [[50, 44], [50, 66], [27, 22], [76, 23], [25, 87], [77, 87]];
  sorted.forEach((id, rank) => {
    let word = document.getElementById(`word-${id}`);
    if (!word) { word = document.createElement('div'); word.id = `word-${id}`; word.className = 'word'; word.innerHTML = '<strong></strong><small></small>'; cloud.appendChild(word); }
    const count = data.counts[id];
    const choice = config.choices.find(item => item.id === id);
    word.querySelector('strong').textContent = choice.title;
    word.querySelector('small').textContent = `${number(count)} ${text('votes')} · ${number(data.total ? Math.round(count / data.total * 100) : 0)}%`;
    word.style.left = `${positions[rank][0]}%`; word.style.top = `${positions[rank][1]}%`;
    const slot = cloud.clientWidth * (rank < 2 ? .86 : .42);
    let size = (42 + 50 * Math.sqrt(count / max)) * Math.min(1, cloud.clientWidth / 1500);
    word.style.fontSize = `${size}px`;
    const strong = word.querySelector('strong');
    if (strong.scrollWidth > slot) { size *= slot / strong.scrollWidth; word.style.fontSize = `${size}px`; }
    word.style.setProperty('--delay', `${ids.indexOf(id) * -1.7}s`);
    word.classList.toggle('gold', rank === 1 || rank === 5);
    word.classList.toggle('dark', rank === 3);
  });
  document.querySelector('#connection').textContent = !connected ? text('offline') : data.total ? '' : text('empty');
}
async function poll() {
  try { data = await (await api('/api/results')).json(); connected = true; } catch { connected = false; }
  updateCloud();
  setTimeout(poll, 3000);
}
function start() {
  if (started) return;
  started = true;
  render();
  if (isResults) poll(); else session();
}
document.querySelector('#language').addEventListener('click', async () => {
  const next = lang === 'en' ? 'ar' : 'en';
  try { config = await loadConfig(next); } catch { return; }
  lang = next;
  try { localStorage.setItem('poll_language', lang); } catch {}
  const url = new URL(location.href); url.searchParams.set('lang', lang); history.replaceState(null, '', url);
  if (!started) start(); else render();
});
window.addEventListener('resize', () => { if (isResults && config) updateCloud(); });
loadConfig(lang).then(loaded => { if (started) return; config = loaded; start(); }).catch(() => {
  main.innerHTML = '<p class="error" role="status">Unable to load configuration.</p>';
});
