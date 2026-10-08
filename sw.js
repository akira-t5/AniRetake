// AniRetake のオフライン用 Service Worker（GitHub Pages などの http(s) で開いたときだけ使う）
// 方針: いつもネットワークを先に見て最新を使い、つながらないときだけ保存しておいた写しを返す。
// これでアプリとしてインストールしても、main を更新すれば次の起動で新しい版になる。
// 保存データ（localStorage / IndexedDB）には一切触れない。
const CACHE = "aniretake-app-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(ASSETS.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
          .then((hit) => hit || Response.error()),
      ),
  );
});
