const api = globalThis.browser || globalThis.chrome;

// This page is a long-lived extension tab, but Firefox does not provide a
// WebExtension equivalent of chrome.tabCapture for arbitrary tab audio.
const tabAudio = new Map();

function respondError() {
  return {
    ok: false,
    error: 'Firefox WebExtensions cannot capture arbitrary tab audio. This Chrome tabCapture extension cannot be ported with equivalent functionality without a browser API or external native component.'
  };
}

api.runtime.onMessage.addListener((message) => {
  if (message?.target !== 'offscreen') return undefined;
  switch (message.command) {
    case 'startTabAudio':
      return Promise.resolve({ ...respondError(), sampleRate: 44100 });
    case 'stopTabAudio':
      tabAudio.delete(message.tabId);
      return Promise.resolve({ ok: true });
    case 'updateAllFilters':
      return Promise.resolve({ ...respondError() });
    case 'getFFT':
      return Promise.resolve({ fft: [] });
    default:
      return Promise.resolve({ ok: false });
  }
});

api.runtime.sendMessage({ type: 'audioUnavailable', ...respondError() }).catch(() => {});
