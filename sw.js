// AniRetake のオフライン用 Service Worker（GitHub Pages などの http(s) で開いたときだけ使う）
// 方針: いつもネットワークを先に見て最新を使い、つながらないときだけ保存しておいた写しを返す。
// これでアプリとしてインストールしても、main を更新すれば次の起動で新しい版になる。
// 保存データ（localStorage / IndexedDB）には一切触れない。
// 同じ github.io の他のツールとキャッシュ置き場を共有するので、消すのは自分の名前のものだけ
const PREFIX = "aniretake-app-",
  CACHE = PREFIX + "v2";
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
      // ブラウザのHTTPキャッシュ（GitHub Pages は10分）を通さず最新を取る
      .then((c) => Promise.all(ASSETS.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // ?utm_source=… などの付いたURLも、付いていない名前で1つだけ写しを持つ（古い写しが残って開かないように）
  const key = new URL(req.url);
  key.search = "";
  key.hash = "";
  e.respondWith(
    fetch(req.mode === "navigate" ? new Request(req, { cache: "no-cache" }) : req)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(key.href, copy)));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(key.href)
          .then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
          .then((hit) => hit || Response.error()),
      ),
  );
});
