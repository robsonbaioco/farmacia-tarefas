// Cache do app para funcionar offline. Aumente a versão ao alterar arquivos.
const CACHE = 'farmatarefas-v5';
/** Arquivos guardados na instalação, para o app abrir sem internet. Arquivo novo do app precisa entrar aqui. */
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

/** Instalação: baixa todos os ASSETS (ignorando o cache HTTP) e ativa a versão nova sem esperar abas fecharem. */
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

/** Ativação: apaga caches de versões antigas (nome diferente de CACHE) e assume as abas abertas. */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (revalidando o cache HTTP para pegar atualizações), cache como reserva offline
/** Só trata GET do próprio site; sem rede, devolve a cópia do cache ou, em último caso, o index.html. */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
