(() => {
  const CHANNEL = 'ears-main-world-v1';
  if (window.__earsMainWorldInstalled) return;
  Object.defineProperty(window, '__earsMainWorldInstalled', { value: true });
  let config = { filters: [], gain: 1, enabled: true };
  const sessions = new WeakMap();
  const activeSessions = new Set();
  const fftAnalyser = null;
  const pendingMedia = new Set();

  function apply(session) {
    const now = session.context.currentTime;
    session.filters.forEach((node, i) => {
      const f = config.filters[i];
      if (!f) return;
      node.type = f.type;
      node.frequency.setTargetAtTime(f.frequency, now, 0.02);
      node.Q.setTargetAtTime(f.q, now, 0.02);
      node.gain.setTargetAtTime(f.gain, now, 0.02);
    });
    session.gain.gain.setTargetAtTime(config.gain, now, 0.02);
    session.wet.gain.setTargetAtTime(config.enabled ? 1 : 0, now, 0.02);
    session.dry.gain.setTargetAtTime(config.enabled ? 0 : 1, now, 0.02);
  }

  function attachMedia(element) {
    if (!(element instanceof HTMLMediaElement) || sessions.has(element) || !config.filters.length) return false;
    let context;
    try {
      context = new (window.AudioContext || window.webkitAudioContext)();
      const source = context.createMediaElementSource(element);
      const filters = config.filters.map((f) => {
        const node = context.createBiquadFilter();
        node.type = f.type; node.frequency.value = f.frequency; node.Q.value = f.q; node.gain.value = f.gain;
        return node;
      });
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      const dry = context.createGain();
      const wet = context.createGain();
      let previous = source;
      filters.forEach((node) => { previous.connect(node); previous = node; });
      previous.connect(gain);
      gain.connect(analyser);
      analyser.connect(wet);
      source.connect(dry);
      wet.connect(context.destination);
      dry.connect(context.destination);
      const session = { element, context, source, filters, gain, analyser, dry, wet };
      sessions.set(element, session);
      activeSessions.add(session);
      apply(session);
      context.resume().catch(() => {});
      window.postMessage({ source: CHANNEL, type: 'attached' }, '*');
      return true;
    } catch (error) {
      if (context && context.state !== 'closed') context.close().catch(() => {});
      window.postMessage({ source: CHANNEL, type: 'error', error: String(error?.message || error) }, '*');
      return false;
    }
  }

  function observeMedia() {
    document.querySelectorAll('audio,video').forEach((media) => {
      if (!sessions.has(media)) pendingMedia.add(media);
    });
    pendingMedia.forEach((media) => {
      if (!media.isConnected) { pendingMedia.delete(media); return; }
      if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && media.paused) return;
      if (attachMedia(media)) pendingMedia.delete(media);
    });
  }

  function configure(message) {
    if (Array.isArray(message.filters)) config.filters = message.filters;
    if (Number.isFinite(message.gain)) config.gain = message.gain;
    if (typeof message.enabled === 'boolean') config.enabled = message.enabled;
    activeSessions.forEach(apply);
    observeMedia();
  }

  function getFFT() {
    let best = null;
    let bestLevel = 0;
    for (const session of activeSessions) {
      if (session.element.paused || session.element.ended || session.context.state !== 'running') continue;
      const bins = new Uint8Array(session.analyser.frequencyBinCount);
      session.analyser.getByteFrequencyData(bins);
      const level = bins.reduce((sum, value) => sum + value, 0) / bins.length;
      if (level > bestLevel) { bestLevel = level; best = Array.from(bins); }
    }
    return best || [];
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== CHANNEL) return;
    if (event.data.type === 'configure') configure(event.data);
    else if (event.data.type === 'getFFT') window.postMessage({ source: CHANNEL, type: 'fft', requestId: event.data.requestId, fft: getFFT() }, '*');
  });

  const observer = new MutationObserver(observeMedia);
  function begin() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('play', observeMedia, true);
    document.addEventListener('loadeddata', observeMedia, true);
    setInterval(observeMedia, 900);
    observeMedia();
  }
  if (document.documentElement) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });
})();
