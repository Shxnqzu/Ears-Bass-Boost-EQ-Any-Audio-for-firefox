# Ears — Firefox tab EQ prototype

Firefox build using the supported WebExtension approach of injecting a content script after the user clicks the EQ button. The script discovers page `<audio>`/`<video>` elements, routes them through Web Audio API filters, and keeps a dry path for EQ bypass.

## Scope and limitations

- Processes HTML media elements in the current page only. It does not capture arbitrary tab/system audio and cannot alter WebAudio-only/custom players that do not expose an `HTMLMediaElement`.
- Browser internal pages, extension pages, protected media/DRM, and some cross-origin/CORS configurations may prohibit injection or produce inaccessible audio.
- An EQ button click may connect media elements found at that moment; a content-side observer adds subsequently inserted elements. The user gesture that starts playback may still be needed to resume each `AudioContext`.
- Disabling EQ crossfades to the unfiltered media source while leaving Web Audio connected, preventing the source from going silent. “Сброс к нулю” sets all filter gains to 0 dB. “Исходные” restores the default frequencies/Q and unity master gain.
- Native Google Fonts are not required for operation; the UI falls back to local system fonts if external fonts cannot load.

## Load temporarily

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **This Firefox** → **Load Temporary Add-on…**.
3. Select `manifest.json` in this directory.
4. Open a normal webpage with an HTML audio/video player, start playback, then click the Ears toolbar icon and **EQ текущей вкладки**.

The add-on needs `activeTab` to inject the script after an explicit toolbar action; injection on restricted pages is expected to fail with a user-facing message.

## Development

The core files are `manifest.json`, `bg.js`, `content.js`, `popup.html`, `popup.css`, and `popup.js`. The older Chrome offscreen files remain in the directory but are no longer part of Firefox audio processing.

Validate JavaScript syntax with `node --check bg.js`, `node --check content.js`, and `node --check popup.js`; validate `manifest.json` as JSON before loading.

This is a prototype; test on target Firefox releases and representative sites before distribution. Per-element Web Audio processing is subject to the site's media/CORS setup and Firefox autoplay policies.
