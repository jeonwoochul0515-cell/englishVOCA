const CACHE_NAME = 'voca1800-v3';

// 앱 핵심 파일
const APP_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js',
  '/vocab.js',
  '/dictionary.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// CDN 리소스 (최초 방문 시 캐싱)
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Noto+Sans:wght@400;600;700&display=swap'
];

// 설치 시: 앱 핵심 파일 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 앱 파일 캐싱
      await cache.addAll(APP_ASSETS);
      // CDN 리소스는 실패해도 설치 차단하지 않음
      for (const url of CDN_ASSETS) {
        try {
          const response = await fetch(url, { mode: 'cors' });
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch (e) {
          console.log('CDN cache skip:', url);
        }
      }
    })
  );
  self.skipWaiting();
});

// 활성화 시: 이전 버전 캐시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 네트워크 요청 전략
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Google Fonts 폰트 파일은 캐시 우선 (변하지 않으므로)
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // CDN 리소스 (Tailwind, Google Fonts CSS): 캐시 우선, 네트워크 폴백
  if (url.hostname === 'cdn.tailwindcss.com' || url.hostname === 'fonts.googleapis.com') {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        // 캐시가 있으면 즉시 반환하고, 백그라운드에서 업데이트
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // 앱 리소스: 네트워크 우선, 캐시 폴백
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 성공하면 캐시에도 저장
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// 새 버전 알림 메시지
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
