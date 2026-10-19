// 앱 파일(아래 ASSETS, data/cards.json 포함)을 바꾸면 VERSION을 꼭 올린다. 규칙은 CLAUDE.md 참고.
const VERSION = 'v3';
const CACHE = `sqld-study-${VERSION}`;

// 오프라인에서 열리려면 앱이 쓰는 파일이 전부 여기 있어야 한다(tests/run_tests.py가 검사).
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'lib/logic.js',
  'lib/sample-db.js',
  'data/cards.json',
  'vendor/sql-wasm.js',
  'vendor/sql-wasm.wasm',
  'manifest.webmanifest',
  'icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sqld-study-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 캐시 우선: 인터넷이 없어도 열린다. 대신 새 파일은 VERSION을 올려야 내려받는다.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
