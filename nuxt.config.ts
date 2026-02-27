// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  ssr: false,

  css: ['~/assets/css/main.css'],

  app: {
    baseURL: '/denchoho-invoice/',
    head: {
      link: [{ rel: 'icon', href: '/denchoho-invoice/favicon.ico' }],
    },
  },

  nitro: {
    preset: 'github-pages',
  },

  modules: [
    '@nuxt/ui',
    '@vueuse/nuxt',
    '@vite-pwa/nuxt',
  ],

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: '電子帳簿保存法 インボイス管理',
      short_name: '電帳法',
      lang: 'ja',
      display: 'standalone',
      theme_color: '#059669',
      background_color: '#ffffff',
      icons: [
        { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    workbox: {
      navigateFallback: null,
      globPatterns: ['**/*.{js,css,ico,png,svg}'],
    },
  },

  runtimeConfig: {
    public: {
      googleClientId: '',
    },
  },
})
