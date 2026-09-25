(() => {
  if (globalThis.__earsContentLoaded) return;
  globalThis.__earsContentLoaded = true;
  const api = globalThis.browser || globalThis.chrome;
  const CHANNEL = 'ears-main-world-v1';
  let config = { filters: [], gain: 1, enabled: true };
  let started = false;
  let observer;
  let scanTimer;
  let mainWorldReady = false;

  function configureMainWorld() {
    window.postMessage({ source: CHANNEL, type: 'configure', ...config }, '*');
  }

  function injectMainWorld() {
    const script = document.createElement('script');
    script.src = api.runtime.getURL('main-world.js');
    script.onload = () => { script.remove(); mainWorldReady = true; configureMainWorld(); };
    script.onerror = () => { script.remove(); console.error('Ears: main-world script injection failed.'); };
    (document.documentElement || document.head).appendChild(script);
  }

  function scan() {
    const count = document.querySelectorAll('audio,video').length;
    if (count && mainWorldReady) configureMainWorld();
    return count;
  }

  function startObserver() {
    if (started) return;
    started = true;
    injectMainWorld();
    observer = new MutationObserver(scan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scanTimer = setInterval(scan, 1000);
    document.addEventListener('play', scan, true);
  }

  const pendingFFT = new Map();
  let fftRequestId = 0;
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== CHANNEL) return;
    if (event.data.type === 'fft' && pendingFFT.has(event.data.requestId)) {
      pendingFFT.get(event.data.requestId)(event.data.fft || []);
      pendingFFT.delete(event.data.requestId);
      return;
    }
    if (event.data.type === 'context') {
      try { api.runtime.sendMessage({ type: 'earsMainWorldStatus', sampleRate: event.data.sampleRate, state: event.data.state }).catch(() => {}); } catch (_) {}
    } else if (event.data.type === 'error') {
      console.warn('Ears main-world audio error:', event.data.error);
    }
  });

  function getFFT() {
    return new Promise((resolve) => {
      const requestId = ++fftRequestId;
      const timeout = setTimeout(() => { pendingFFT.delete(requestId); resolve([]); }, 180);
      pendingFFT.set(requestId, (fft) => { clearTimeout(timeout); resolve(fft); });
      window.postMessage({ source: CHANNEL, type: 'getFFT', requestId }, '*');
    });
  }

  function handleCommand(message) {
    if (message.command === 'enable' || message.command === 'update') {
      config = {
        filters: Array.isArray(message.filters) ? message.filters : config.filters,
        gain: Number.isFinite(message.gain) ? message.gain : config.gain,
        enabled: message.enabled === undefined ? config.enabled : Boolean(message.enabled)
      };
      startObserver();
      configureMainWorld();
      return { ok: true, count: document.querySelectorAll('audio,video').length, pending: !mainWorldReady };
    }
    if (message.command === 'getFFT') return getFFT().then(fft => ({ ok: true, fft }));
    if (message.command === 'disable') {
      config.enabled = false;
      configureMainWorld();
      return { ok: true };
    }
    return { ok: false, error: 'Unknown command' };
  }

  if (globalThis.browser?.runtime?.onMessage) {
    api.runtime.onMessage.addListener((message) => {
      if (message?.target !== 'ears-content') return undefined;
      return Promise.resolve(handleCommand(message));
    });
  } else {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.target !== 'ears-content') return false;
      sendResponse(handleCommand(message));
      return false;
    });
  }
})();
