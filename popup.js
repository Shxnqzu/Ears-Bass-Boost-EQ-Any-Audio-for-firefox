(() => {
  const api = globalThis.browser || globalThis.chrome;
  const send = (message) => api.runtime.sendMessage(message).catch(() => {});
  const request = (message) => api.runtime.sendMessage(message);
  const byId = (id) => document.getElementById(id);
  let presets = {};
  const BUILTIN_PRESETS = [
    { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { name: 'Рок', gains: [4, 3, 2, -1, -2, 2, 4, 5, 4] },
    { name: 'Поп', gains: [-1, 1, 3, 4, 2, 0, -1, -1, 0] },
    { name: 'Джаз', gains: [3, 2, 1, 2, -1, -1, 1, 2, 3] },
    { name: 'Классика', gains: [3, 2, 1, 0, 0, 1, 2, 3, 4] },
    { name: 'Хип-хоп', gains: [5, 4, 2, 0, -1, 1, 2, 3, 3] },
    { name: 'Электроника', gains: [4, 3, 0, -2, 1, 0, 2, 4, 5] },
    { name: 'Вокал', gains: [-3, -2, 0, 3, 4, 3, 1, 0, -1] },
    { name: 'Подкаст', gains: [-5, -2, 1, 4, 5, 4, 2, -1, -4] },
    { name: 'Акустика', gains: [2, 1, 0, 1, 2, 3, 2, 1, 2] },
    { name: 'Ночная', gains: [2, 1, 0, -1, 1, 2, 1, -1, -2] },
    { name: 'V-образная', gains: [5, 4, 2, 0, -2, 0, 2, 4, 5] }
  ];
  let workspace = { eqFilters: [], gain: 1, enabled: true, streams: [] };
  let selectedTabId = null;
  let drawFrame = 0;
  let dragFrame = 0;
  let currentFft = [];
  let targetFft = [];
  let spectrumPath = null;
  let spectrumFrame = 0;
  let fftRequestGeneration = 0;
  let theme = { preset: 'aurora', colorA: '#b59cff', colorB: '#79e4e5' };
  const THEME_PRESETS = { aurora: ['#b59cff', '#79e4e5'], sunset: ['#ff8a75', '#ffc66d'], ocean: ['#55c8ff', '#657bff'], forest: ['#72e0a4', '#b8df70'] };
  let pendingFilter = null;
  let dragIndex = -1;

  function validColor(value, fallback) { return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback; }
  function setTheme(next, save = true) {
    theme = { preset: next.preset || 'custom', colorA: validColor(next.colorA, '#b59cff'), colorB: validColor(next.colorB, '#79e4e5') };
    const root = document.documentElement;
    const [r, g, b] = theme.colorA.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16));
    root.style.setProperty('--accent-a', theme.colorA); root.style.setProperty('--accent-b', theme.colorB);
    root.style.setProperty('--purple', theme.colorA); root.style.setProperty('--cyan', theme.colorB);
    root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},.24)`);
    const a = byId('themeColorA'); const bColor = byId('themeColorB');
    if (a) a.value = theme.colorA; if (bColor) bColor.value = theme.colorB;
    const preview = byId('gradientPreview'); if (preview) preview.style.background = `linear-gradient(115deg,${theme.colorA},${theme.colorB})`;
    document.querySelectorAll('.theme-card').forEach(card => card.classList.toggle('active', card.dataset.theme === theme.preset));
    if (save) api.storage.local.set({ ears_theme: theme }).catch(() => {});
  }
  async function loadTheme() {
    try { const data = await api.storage.local.get('ears_theme'); if (data?.ears_theme) setTheme(data.ears_theme, false); }
    catch (_) { /* Keep the default theme when storage is unavailable. */ }
  }
  function notify(text) {
    const box = byId('requiresProDiv');
    if (!box) return;
    box.textContent = text;
    box.classList.add('show');
    setTimeout(() => box.classList.remove('show'), 6500);
  }
  function applyBuiltInPreset(preset) {
    if (preset.name === 'Flat') {
      send({ type: 'resetFilters' });
      return;
    }
    const eqFilters = workspace.eqFilters.map((filter, index) => ({ ...filter, gain: preset.gains[index] ?? 0 }));
    send({ type: 'applyFilters', filters: eqFilters, gain: workspace.gain });
  }
  function renderBuiltInPresets() {
    const holder = byId('builtinPresetSpan');
    if (!holder) return;
    holder.replaceChildren();
    BUILTIN_PRESETS.forEach((preset) => {
      const button = document.createElement('button');
      button.textContent = preset.name;
      button.title = `Применить пресет «${preset.name}»`;
      button.addEventListener('click', () => applyBuiltInPreset(preset));
      holder.appendChild(button);
    });
  }
  function renderBandControls() {
    const holder = byId('bandControls');
    if (!holder || !workspace.eqFilters.length) return;
    const focused = document.activeElement;
    const focusedBand = focused?.closest?.('[data-band-index]');
    const preserveFocus = focusedBand ? { index: Number(focusedBand.dataset.bandIndex), name: focused.dataset.control } : null;
    holder.replaceChildren();
    workspace.eqFilters.forEach((filter, index) => {
      const card = document.createElement('div');
      card.className = 'band-control-card';
      card.dataset.bandIndex = String(index);
      const title = document.createElement('div');
      title.className = 'band-control-title';
      const label = document.createElement('strong');
      label.textContent = filter.type === 'lowshelf' ? 'LOW SHELF' : filter.type === 'highshelf' ? 'HIGH SHELF' : `BAND ${String(index).padStart(2, '0')}`;
      const readout = document.createElement('span');
      readout.className = 'band-gain-readout';
      readout.textContent = `${filter.gain > 0 ? '+' : ''}${Number(filter.gain).toFixed(1)} dB`;
      title.append(label, readout);
      const gain = document.createElement('input');
      gain.type = 'range'; gain.min = '-24'; gain.max = '24'; gain.step = '0.1'; gain.value = String(filter.gain);
      gain.dataset.control = 'gain'; gain.setAttribute('aria-label', `Усиление полосы ${index + 1}, dB`);
      gain.addEventListener('input', () => {
        readout.textContent = `${Number(gain.value) > 0 ? '+' : ''}${Number(gain.value).toFixed(1)} dB`;
        workspace.eqFilters[index] = { ...workspace.eqFilters[index], gain: Number(gain.value) };
        updateBandDot(index);
        scheduleFilterUpdate(index);
      });
      const params = document.createElement('div'); params.className = 'band-param-row';
      const freqLabel = document.createElement('label'); freqLabel.textContent = 'Частота';
      const freq = document.createElement('input'); freq.type = 'number'; freq.min = '10'; freq.max = '30000'; freq.step = '1'; freq.value = String(Math.round(filter.frequency));
      freq.dataset.control = 'frequency'; freq.setAttribute('aria-label', `Частота полосы ${index + 1}, Гц`);
      freq.addEventListener('change', () => {
        const value = Math.max(10, Math.min(30000, Number(freq.value) || filter.frequency));
        freq.value = String(Math.round(value));
        updateBandParameter(index, 'frequency', value);
      });
      freqLabel.appendChild(freq);
      const qLabel = document.createElement('label'); qLabel.textContent = 'Q';
      const q = document.createElement('input'); q.type = 'number'; q.min = '0.1'; q.max = '10'; q.step = '0.1'; q.value = Number(filter.q).toFixed(1);
      q.dataset.control = 'q'; q.setAttribute('aria-label', `Q полосы ${index + 1}`);
      q.addEventListener('change', () => {
        const value = Math.max(0.1, Math.min(10, Number(q.value) || filter.q));
        q.value = value.toFixed(1);
        updateBandParameter(index, 'q', value);
      });
      qLabel.appendChild(q);
      const reset = document.createElement('button'); reset.className = 'band-reset'; reset.textContent = '↺'; reset.title = 'Сбросить полосу'; reset.setAttribute('aria-label', `Сбросить полосу ${index + 1}`);
      reset.addEventListener('click', () => send({ type: 'resetFilter', index }));
      params.append(freqLabel, qLabel, reset);
      card.append(title, gain, params);
      holder.appendChild(card);
    });
    if (preserveFocus) holder.querySelector(`[data-band-index="${preserveFocus.index}"] [data-control="${preserveFocus.name}"]`)?.focus({ preventScroll: true });
  }
  let filterUpdateTimer;
  function scheduleFilterUpdate(index) {
    clearTimeout(filterUpdateTimer);
    const filter = workspace.eqFilters[index];
    filterUpdateTimer = setTimeout(() => send({ type: 'modifyFilter', index, frequency: filter.frequency, gain: filter.gain, q: filter.q }), 60);
  }
  function updateBandParameter(index, key, value) {
    const filter = workspace.eqFilters[index];
    workspace.eqFilters[index] = { ...filter, [key]: value };
    send({ type: 'modifyFilter', index, frequency: workspace.eqFilters[index].frequency, gain: workspace.eqFilters[index].gain, q: workspace.eqFilters[index].q });
    drawEq();
  }
  function updateBandDot(index) {
    const svg = byId('eqSvg');
    const node = svg?.querySelector(`[data-filter-index="${index}"]`);
    if (!node) { drawEq(); return; }
    const p = graphPosition(workspace.eqFilters[index], 600, 300);
    node.setAttribute('cy', p.y);
    drawEq();
  }
  function renderPresets() {
    const holder = byId('userPresetSpan');
    if (!holder) return;
    holder.replaceChildren();
    Object.keys(presets).forEach((name) => {
      const button = document.createElement('button');
      button.textContent = name;
      button.title = `Применить «${name}»`;
      button.addEventListener('click', () => { byId('presetNameInput').value = name; send({ type: 'preset', preset: name }); });
      holder.appendChild(button);
    });
  }
  function renderTabs() {
    const list = byId('eqTabList');
    const count = byId('activeCount');
    if (!list) return;
    list.replaceChildren();
    if (count) count.textContent = String(workspace.streams.length);
    if (!workspace.streams.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<span>◌</span><strong>Нет активных вкладок</strong><p>Нажми «EQ текущей вкладки», чтобы подключить медиаплеер.</p>';
      list.appendChild(empty);
      return;
    }
    workspace.streams.forEach((tab) => {
      const row = document.createElement('div');
      const title = document.createElement('span');
      title.textContent = tab.title || `Вкладка ${tab.id}`;
      const meta = document.createElement('small');
      meta.textContent = `${tab.mediaCount || 0} медиа`;
      const button = document.createElement('button');
      button.textContent = 'Отключить';
      button.addEventListener('click', () => send({ type: 'disconnectTab', tab }));
      row.append(title, meta, button);
      list.appendChild(row);
    });
  }
  function updateControls() {
    const button = byId('eqTabButton');
    const active = workspace.streams.some((tab) => tab.id === selectedTabId);
    if (button) {
      button.querySelector('.button-label').textContent = active ? 'Отключить текущую вкладку' : 'EQ текущей вкладки';
      button.onclick = () => send({ type: 'eqTab', on: !active });
    }
    const toggle = byId('toggleEqButton');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(Boolean(workspace.enabled)));
      byId('toggleEqLabel').textContent = workspace.enabled ? 'EQ включён' : 'EQ выключен';
    }
    const slider = byId('gainSlider');
    const gainPercent = Math.min(200, Math.round((workspace.gain || 0) * 100));
    if (slider && document.activeElement !== slider) slider.value = String(gainPercent);
    const gainValue = byId('gainValue');
    if (gainValue && document.activeElement !== slider) gainValue.textContent = `${gainPercent}%`;
  }
  function graphPosition(filter, width, height) {
    return {
      x: Math.max(0, Math.min(width, Math.log10(Math.max(10, Math.min(30000, filter.frequency)) / 10) / Math.log10(3000) * width)),
      y: height / 2 - Math.max(-24, Math.min(24, filter.gain)) * (height / 48)
    };
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgElement(tag, attrs = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
    return element;
  }
  function drawEq() {
    const svg = byId('eqSvg');
    if (!svg || !workspace.eqFilters.length) return;
    svg.replaceChildren();
    const width = 600; const height = 300; const mid = height / 2;
    for (let db = -24; db <= 24; db += 12) {
      const y = mid - db * (height / 48);
      svg.appendChild(svgElement('line', { x1: 0, y1: y, x2: width, y2: y, stroke: db === 0 ? 'rgba(198,205,231,.24)' : 'rgba(166,177,211,.085)', 'stroke-width': db === 0 ? 1.5 : 1, 'stroke-dasharray': db === 0 ? '' : '3 7' }));
    }
    for (let decade = 10; decade <= 30000; decade *= 10) {
      for (let multiple = 1; multiple < 10; multiple += 1) {
        const hz = decade * multiple;
        if (hz > 30000) break;
        const x = Math.log10(hz / 10) / Math.log10(3000) * width;
        svg.appendChild(svgElement('line', { x1: x, y1: 0, x2: x, y2: height, stroke: multiple === 1 ? 'rgba(166,177,211,.1)' : 'rgba(166,177,211,.035)', 'stroke-width': 1 }));
      }
    }
    const points = workspace.eqFilters.map((filter) => graphPosition(filter, width, height));
    let path = `M0,${mid} L${points[0].x},${points[0].y}`;
    points.forEach((point, index) => {
      if (!index) return;
      const previous = points[index - 1];
      const middleX = (previous.x + point.x) / 2;
      path += ` C${middleX},${previous.y} ${middleX},${point.y} ${point.x},${point.y}`;
    });
    path += ` L${width},${mid}`;
    svg.appendChild(svgElement('path', { d: `${path} L0,${mid} Z`, fill: 'rgba(181,156,255,.07)', stroke: 'none' }));
    svg.appendChild(svgElement('path', { d: path, fill: 'none', stroke: theme.colorA, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    workspace.eqFilters.forEach((filter, index) => {
      const point = points[index];
      const color = index === 0 || index === workspace.eqFilters.length - 1 ? theme.colorA : theme.colorB;
      svg.appendChild(svgElement('circle', { cx: point.x, cy: point.y, r: 12, fill: color, opacity: .17 }));
      const hit = svgElement('circle', { cx: point.x, cy: point.y, r: 16, fill: 'transparent', stroke: 'none', class: 'filterHit', tabindex: 0, role: 'slider', 'aria-label': `${filter.type === 'lowshelf' ? 'Low shelf' : filter.type === 'highshelf' ? 'High shelf' : `Band ${index + 1}`}: ${Math.round(filter.frequency)} Hz, ${filter.gain.toFixed(1)} dB` });
      hit.dataset.filterIndex = String(index);
      const dot = svgElement('circle', { cx: point.x, cy: point.y, r: 5, fill: color, stroke: '#111624', 'stroke-width': 1.5, class: 'filterDot', 'data-filter-index': index });
      hit.style.cursor = 'grab'; dot.style.pointerEvents = 'none';
      svg.append(hit, dot);
      hit.addEventListener('keydown', (event) => {
        const current = workspace.eqFilters[index];
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const gain = Math.max(-24, Math.min(24, current.gain + (event.key === 'ArrowUp' ? 1 : -1)));
          workspace.eqFilters[index] = { ...current, gain };
          send({ type: 'modifyFilter', index, frequency: current.frequency, gain, q: current.q });
          drawEq();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const factor = event.key === 'ArrowRight' ? 1.08 : 1 / 1.08;
          const frequency = Math.max(10, Math.min(30000, current.frequency * factor));
          workspace.eqFilters[index] = { ...current, frequency };
          send({ type: 'modifyFilter', index, frequency, gain: current.gain, q: current.q });
          drawEq();
        }
      });
      hit.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        dragIndex = index;
        const move = (e) => {
          if (dragIndex < 0) return;
          const rect = svg.getBoundingClientRect();
          const px = Math.max(0, Math.min(600, (e.clientX - rect.left) * 600 / rect.width));
          const py = Math.max(0, Math.min(300, (e.clientY - rect.top) * 300 / rect.height));
          const filterNow = workspace.eqFilters[dragIndex];
          const frequency = Math.max(10, Math.min(30000, 10 * Math.pow(3000, px / 600)));
          const gain = Math.max(-24, Math.min(24, (150 - py) / (300 / 48)));
          workspace.eqFilters[dragIndex] = { ...filterNow, frequency, gain };
          pendingFilter = { type: 'modifyFilter', index: dragIndex, frequency, gain, q: filterNow.q };
          cancelAnimationFrame(drawFrame);
          drawFrame = requestAnimationFrame(drawEq);
          cancelAnimationFrame(dragFrame);
          dragFrame = requestAnimationFrame(() => { if (pendingFilter) send(pendingFilter); });
        };
        const end = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          if (pendingFilter) send(pendingFilter);
          pendingFilter = null;
          dragIndex = -1;
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
      });
    });
  }
  async function importFile(file) {
    try { send({ type: 'importPresets', presets: JSON.parse(await file.text()) }); }
    catch (_) { notify('Не удалось прочитать JSON-файл пресетов.'); }
  }
  function activatePanel(id) {
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === id));
    document.querySelectorAll('.tab-button').forEach((button) => button.classList.toggle('active', button.dataset.panel === id));
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await loadTheme();
    if (new URLSearchParams(location.search).has('fullscreen')) document.body.classList.add('fullscreen-mode');
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    selectedTabId = tabs[0]?.id ?? null;
    document.querySelectorAll('.tab-button').forEach((button) => button.addEventListener('click', () => activatePanel(button.dataset.panel)));
    renderBuiltInPresets();
    renderBandControls();
    byId('resetFiltersButton')?.addEventListener('click', () => send({ type: 'resetFilters' }));
    byId('restoreDefaultsButton')?.addEventListener('click', () => send({ type: 'restoreDefaults' }));
    byId('toggleEqButton')?.addEventListener('click', () => send({ type: 'toggleEq' }));
    byId('bassBoostButton')?.addEventListener('click', () => send({ type: 'preset', preset: 'bassBoost' }));
    byId('savePresetButton')?.addEventListener('click', () => {
      const name = byId('presetNameInput').value.trim();
      if (name) send({ type: 'savePreset', preset: name }); else notify('Сначала укажи название пресета.');
    });
    byId('deletePresetButton')?.addEventListener('click', () => { const name = byId('presetNameInput').value.trim(); if (name) send({ type: 'deletePreset', preset: name }); });
    byId('presetNameInput')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') byId('savePresetButton').click(); });
    byId('exportPresetsButton')?.addEventListener('click', () => send({ type: 'exportPresets' }));
    byId('importPresetsButton')?.addEventListener('click', () => byId('importPresetsFile').click());
    byId('importPresetsFile')?.addEventListener('change', (event) => { if (event.target.files[0]) importFile(event.target.files[0]); event.target.value = ''; });
    const gainSlider = byId('gainSlider');
    gainSlider?.addEventListener('input', (event) => {
      const percent = Math.min(200, Number(event.target.value));
      byId('gainValue').textContent = `${percent}%`;
      send({ type: 'modifyGain', gain: percent / 100 });
    });
    byId('fullscreen-link')?.addEventListener('click', (event) => { event.preventDefault(); api.tabs.create({ url: `${api.runtime.getURL('popup.html')}?fullscreen=1` }); });
    document.querySelectorAll('.theme-card').forEach(card => card.addEventListener('click', () => {
      const colors = THEME_PRESETS[card.dataset.theme];
      if (colors) setTheme({ preset: card.dataset.theme, colorA: colors[0], colorB: colors[1] });
    }));
    const updateThemePreview = () => { byId('gradientPreview').style.background = `linear-gradient(115deg,${byId('themeColorA').value},${byId('themeColorB').value})`; };
    byId('themeColorA')?.addEventListener('input', updateThemePreview);
    byId('themeColorB')?.addEventListener('input', updateThemePreview);
    byId('applyCustomTheme')?.addEventListener('click', () => setTheme({ preset: 'custom', colorA: byId('themeColorA').value, colorB: byId('themeColorB').value }));
    byId('resetTheme')?.addEventListener('click', () => setTheme({ preset: 'aurora', colorA: THEME_PRESETS.aurora[0], colorB: THEME_PRESETS.aurora[1] }));
    setInterval(async () => {
      if (!workspace.enabled || !workspace.streams.length || document.hidden) {
        fftRequestGeneration += 1;
        targetFft = [];
        return;
      }
      const generation = fftRequestGeneration;
      const result = await request({ type: 'getFFT' }).catch(() => null);
      if (generation !== fftRequestGeneration || !workspace.enabled || document.hidden) return;
      targetFft = result?.fft?.slice(0, 96) || [];
    }, 100);
    function animateSpectrum() {
      spectrumFrame = requestAnimationFrame(animateSpectrum);
      const svg = byId('eqSvg');
      if (!svg || document.hidden) return;
      if (!workspace.enabled) {
        currentFft = [];
        targetFft = [];
        if (spectrumPath) { spectrumPath.remove(); spectrumPath = null; }
        return;
      }
      const length = Math.max(currentFft.length, targetFft.length);
      if (!length) {
        if (spectrumPath) { spectrumPath.remove(); spectrumPath = null; }
        currentFft = [];
        return;
      }
      if (!spectrumPath) {
        spectrumPath = svgElement('path', { 'data-spectrum-line': 'true', fill: 'none', stroke: theme.colorB, opacity: .72, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        svg.appendChild(spectrumPath);
      }
      let path = '';
      for (let i = 0; i < length; i += 1) {
        const target = targetFft[i] || 0;
        const previous = currentFft[i] || 0;
        const value = previous + (target - previous) * .16;
        currentFft[i] = value;
        const x = i / Math.max(1, length - 1) * 600;
        const y = 150 - (value / 255) * 92;
        path += `${i ? ' L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      spectrumPath.setAttribute('d', path);
      spectrumPath.setAttribute('stroke', theme.colorB);
    }
    animateSpectrum();
    api.runtime.onMessage.addListener((message) => {
      if (message.type === 'sendPresets') { presets = message.presets || {}; renderPresets(); }
      if (message.type === 'sendWorkspaceStatus') {
        const wasEnabled = workspace.enabled;
        workspace = { ...workspace, ...message };
        if (workspace.enabled !== wasEnabled) {
          fftRequestGeneration += 1;
          currentFft = [];
          targetFft = [];
          if (spectrumPath) { spectrumPath.remove(); spectrumPath = null; }
        }
        renderTabs(); drawEq();
        if (!document.activeElement?.closest?.('#bandControls')) renderBandControls();
        updateControls();
      }
      if (message.type === 'sendCurrentTabStatus') updateControls();
      if (message.type === 'audioError') notify(message.error || 'Не удалось подключить аудио на этой вкладке.');
    });
    try { const result = await request({ type: 'PING' }); if (result?.reply === 'PONG') send({ type: 'onPopupOpen' }); }
    catch (_) { notify('Нет связи с фоновым процессом расширения.'); }
  });
})();
