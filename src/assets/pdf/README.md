# PDF renderer WASM (from @imggion/html2realpdf)

Copied from the npm package so Vite can serve it under the app origin
(`src/` root). Loading via `@fs/.../node_modules/...` is rejected with HTTP 403
in the Tauri WebView.

Keep in sync with `deps/node_modules/@imggion/html2realpdf/dist/libhtml2realpdf.wasm`
when upgrading that dependency:

```sh
cp deps/node_modules/@imggion/html2realpdf/dist/libhtml2realpdf.wasm \
  src/assets/pdf/libhtml2realpdf.wasm
```
