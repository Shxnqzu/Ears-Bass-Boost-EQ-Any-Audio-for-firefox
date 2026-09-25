(() => {
  const api = globalThis.browser || globalThis.chrome;
  const DEFAULT_FILTERS = [
    { type: 'lowshelf', frequency: 60, q: 0.7, gain: 0 },
    { type: 'peaking', frequency: 170, q: 1, gain: 0 },
    { type: 'peaking', frequency: 310, q: 1, gain: 0 },
    { type: 'peaking', frequency: 600, q: 1, gain: 0 },
    { type: 'peaking', frequency: 1000, q: 1, gain: 0 },
    { type: 'peaking', frequency: 3000, q: 1, gain: 0 },
    { type: 'peaking', frequency: 6000, q: 1, gain: 0 },
    { type: 'peaking', frequency: 12000, q: 1, gain: 0 },
    { type: 'highshelf', frequency: 14000, q: 0.7, gain: 0 }
  ];
  const storageKey = 'ears_presets_v1';
  const workspace = { eqFilters: structuredClone(DEFAULT_FILTERS), gain: 1, enabled: true, streams: [], presets: {} };
  let initPromise;

  function numeric(value, fallback) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
  function normalizePreset(raw) {
    const filters = raw?.eqFilters || raw?.filters || (Array.isArray(raw) ? raw : null);
    if (!Array.isArray(filters)) return null;
    return {
      eqFilters: DEFAULT_FILTERS.map((base, i) => {
        const item = filters[i] || {};
        return { type: ['peaking', 'lowshelf', 'highshelf'].includes(item.type) ? item.type : base.type, frequency: numeric(item.frequency, base.frequency), q: numeric(item.q, base.q), gain: numeric(item.gain, base.gain) };
      }),
      gain: numeric(raw.gain, 1)
    };
  }
  async function initialize() {
    if (!initPromise) initPromise = api.storage.local.get(storageKey).then(data => {
      const raw = data[storageKey] || {};
      const presets = raw?.presets && typeof raw.presets === 'object' ? raw.presets : raw;
      workspace.presets = Object.fromEntries(Object.entries(presets).map(([name, value]) => [name, normalizePreset(value)]).filter(([, value]) => value));
    }).catch(error => console.error('Preset load failed', error));
    return initPromise;
  }
  async function persistPresets() { await api.storage.local.set({ [storageKey]: workspace.presets }); }
  function emit(message) { api.runtime.sendMessage(message).catch(() => {}); }
  function publish() { emit({ type: 'sendWorkspaceStatus', eqFilters: structuredClone(workspace.eqFilters), gain: workspace.gain, enabled: workspace.enabled, streams: workspace.streams }); emit({ type: 'sendPresets', presets: workspace.presets }); }
  async function inject(tabId) {
    if (api.scripting?.executeScript) {
      await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return;
    }
    if (api.tabs.executeScript) {
      await api.tabs.executeScript(tabId, { file: 'content.js' });
      return;
    }
    throw new Error('Вставка content script недоступна в этой версии Firefox.');
  }
  async function commandTab(tabId, command) {
    await inject(tabId);
    try { return await api.tabs.sendMessage(tabId, { target: 'ears-content', command, filters: workspace.eqFilters, gain: workspace.gain, enabled: workspace.enabled }); }
    catch (error) { throw new Error(`Не удалось связаться со страницей вкладки: ${error.message}`); }
  }
  async function startEq(tabId) {
    if (workspace.streams.some(item => item.id === tabId)) return;
    const tab = await api.tabs.get(tabId);
    let result = await commandTab(tabId, 'enable');
    for (let attempt = 0; attempt < 30 && result?.pending; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
      result = await commandTab(tabId, 'update');
    }
    if (!result?.count) throw new Error('Не найден доступный audio/video. Запустите видео и попробуйте снова.');
    workspace.streams.push({ id: tabId, title: tab.title || `Tab ${tabId}`, favIconUrl: tab.favIconUrl || '', mediaCount: result.count });
  }
  async function stopEq(tabId) {
    if (workspace.streams.some(item => item.id === tabId)) {
      try { await commandTab(tabId, 'disable'); } catch (error) { console.warn(error); }
    }
    workspace.streams = workspace.streams.filter(item => item.id !== tabId);
  }
  async function syncTabs() {
    for (let i = workspace.streams.length - 1; i >= 0; i -= 1) {
      const stream = workspace.streams[i];
      try {
        const result = await commandTab(stream.id, 'update');
        stream.mediaCount = result?.count ?? stream.mediaCount;
      } catch (error) {
        console.warn('Removing disconnected tab', error);
        workspace.streams.splice(i, 1);
      }
    }
  }
  function applyPreset(name) {
    if (name === 'bassBoost') {
      workspace.eqFilters = DEFAULT_FILTERS.map(filter => ({ ...filter, gain: filter.type === 'lowshelf' ? 10 : filter.frequency < 250 ? 5 : filter.frequency > 6000 ? -2 : 0 }));
      return;
    }
    const preset = normalizePreset(workspace.presets[name]);
    if (preset) { workspace.eqFilters = preset.eqFilters; workspace.gain = preset.gain; }
  }

  api.tabs.onRemoved.addListener(tabId => {
    workspace.streams = workspace.streams.filter(item => item.id !== tabId);
    publish();
  });
  api.runtime.onMessage.addListener((message, sender) => (async () => {
    await initialize();
    switch (message?.type) {
      case 'PING': return { reply: 'PONG' };
      case 'onPopupOpen': case 'getFullRefresh': publish(); return;
      case 'eqTab': {
        const tabs = sender?.tab?.id != null ? [{ id: sender.tab.id }] : await api.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (tabId == null) return;
        try {
          if (message.on) await startEq(tabId); else await stopEq(tabId);
        } catch (error) { emit({ type: 'audioError', error: error.message }); }
        emit({ type: 'sendCurrentTabStatus', streaming: workspace.streams.some(item => item.id === tabId) });
        publish();
        return;
      }
      case 'disconnectTab': if (message.tab?.id != null) { await stopEq(message.tab.id); publish(); } return;
      case 'applyFilters': if (Array.isArray(message.filters)) {
        workspace.eqFilters = DEFAULT_FILTERS.map((base, index) => {
          const item = message.filters[index] || base;
          return { type: base.type, frequency: Math.max(10, Math.min(30000, numeric(item.frequency, base.frequency))), gain: Math.max(-24, Math.min(24, numeric(item.gain, base.gain))), q: Math.max(0.1, Math.min(10, numeric(item.q, base.q))) };
        });
        workspace.gain = Math.max(0, Math.min(2, numeric(message.gain, workspace.gain)));
        await syncTabs(); publish();
      } return;
      case 'modifyFilter': if (workspace.eqFilters[message.index]) {
        const previous = workspace.eqFilters[message.index];
        workspace.eqFilters[message.index] = { ...previous, frequency: Math.max(10, Math.min(30000, numeric(message.frequency, previous.frequency))), gain: Math.max(-24, Math.min(24, numeric(message.gain, previous.gain))), q: Math.max(0.1, Math.min(10, numeric(message.q, previous.q))) };
        await syncTabs(); publish();
      } return;
      case 'resetFilter': if (workspace.eqFilters[message.index]) { workspace.eqFilters[message.index] = { ...DEFAULT_FILTERS[message.index] }; await syncTabs(); publish(); } return;
      case 'modifyGain': case 'gainUpdated': workspace.gain = Math.max(0, Math.min(2, numeric(message.gain, 1))); await syncTabs(); publish(); return;
      case 'toggleEq': workspace.enabled = message.enabled === undefined ? !workspace.enabled : Boolean(message.enabled); await syncTabs(); publish(); return;
      case 'resetFilters': workspace.eqFilters = DEFAULT_FILTERS.map(filter => ({ ...filter, gain: 0 })); await syncTabs(); publish(); return;
      case 'restoreDefaults': workspace.eqFilters = structuredClone(DEFAULT_FILTERS); workspace.gain = 1; workspace.enabled = true; await syncTabs(); publish(); return;
      case 'preset': applyPreset(message.preset); await syncTabs(); publish(); return;
      case 'savePreset': if (message.preset) { workspace.presets[message.preset] = { eqFilters: structuredClone(workspace.eqFilters), gain: workspace.gain }; await persistPresets(); emit({ type: 'sendPresets', presets: workspace.presets }); } return;
      case 'deletePreset': delete workspace.presets[message.preset]; await persistPresets(); emit({ type: 'sendPresets', presets: workspace.presets }); return;
      case 'exportPresets': {
        const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(workspace.presets, null, 2))}`;
        await api.downloads.download({ url, filename: 'ears-presets.json', saveAs: true }); return;
      }
      case 'importPresets': {
        const raw = message.presets?.presets && typeof message.presets.presets === 'object' ? message.presets.presets : message.presets || {};
        for (const [name, value] of Object.entries(raw)) { const preset = normalizePreset(value); if (preset) workspace.presets[name] = preset; }
        await persistPresets(); emit({ type: 'sendPresets', presets: workspace.presets }); return;
      }
      case 'getFFT': {
        const streams = await Promise.all(workspace.streams.map(async stream => {
          try { return await api.tabs.sendMessage(stream.id, { target: 'ears-content', command: 'getFFT' }); }
          catch (_) { return null; }
        }));
        return { fft: streams.find(item => item?.fft?.length)?.fft || [] };
      }
      default: return;
    }
  })().catch(error => { console.error('Ears background error', error); if (message?.type === 'getFFT') return { fft: [] }; }));
  void initialize();
})();
