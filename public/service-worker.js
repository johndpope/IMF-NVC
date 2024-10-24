// service-worker.js
const MODEL_VERSION = 'v1';
const CACHE_NAME = `nvc-model-cache-${MODEL_VERSION}`;
const MODEL_BASE_URL = 'https://192.168.1.108:3001/graph_model_client';

// Add development logging
const DEBUG = true;
function log(...args) {
  if (DEBUG) {
    console.log('[ServiceWorker]', ...args);
  }
}

// Generate array of shard URLs
const generateShardUrls = (baseUrl, shardCount) => {
  const urls = [];
  // Add model.json
  urls.push(`${baseUrl}/model.json`);
  // Add all shards
  for (let i = 1; i <= shardCount; i++) {
    urls.push(`${baseUrl}/group1-shard${i}of${shardCount}.bin`);
  }
  return urls;
};


const MODEL_URLS = generateShardUrls(MODEL_BASE_URL, 60);

// Install event - cache all model files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching model files...');
      return cache.addAll(MODEL_URLS).then(() => {
        console.log('Model files cached successfully');
      });
    })
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith('nvc-model-cache-') && cacheName !== CACHE_NAME) {
            console.log('Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - serve from cache, falling back to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  if (url.pathname.startsWith('/graph_model_client/')) {
    event.respondWith(
      (async () => {
        try {
          // Try cache first
          const cache = await caches.open(CACHE_NAME);
          let response = await cache.match(event.request);
          
          if (response) {
            log('Serving from cache:', url.pathname);
            return response;
          }

          // Network fetch with error handling
          log('Fetching from network:', url.pathname);
          response = await fetch(event.request, {
            // Add credentials for development
            credentials: 'include',
          });

          if (!response.ok) {
            throw new Error(`Network response was not ok: ${response.status}`);
          }

          // Cache the response
          await cache.put(event.request, response.clone());
          return response;
        } catch (error) {
          log('Fetch error:', error);
          throw error;
        }
      })()
    );
  }
});

// Add development message handling
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Add activation logging
self.addEventListener('activate', (event) => {
  log('Service worker activated');
  event.waitUntil(
    (async () => {
      // Clear old caches
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter(key => key.startsWith('nvc-model-cache-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
      
      // Take control immediately
      await self.clients.claim();
      log('Service worker claimed clients');
    })()
  );
});