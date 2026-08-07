# PDF renderer WASM (from @imggion/html2realpdf)

`libhtml2realpdf.wasm` is **not** committed. Vite must serve it under the app
origin (`src/` root); loading via `@fs/.../node_modules/...` is rejected with
HTTP 403 in the Tauri WebView.

After `npm install`, sync (also runs at the end of `npm run build`):

```sh
npm run check:pdf-wasm
```

This copies `deps/node_modules/@imggion/html2realpdf/dist/libhtml2realpdf.wasm`
into this directory when missing or out of date.
