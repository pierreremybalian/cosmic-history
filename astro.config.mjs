// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Static output for Cloudflare Pages. No SSR adapter, no backend (HANDOFF §1).
export default defineConfig({
  site: 'https://cosmic-history.pages.dev',
  output: 'static',
  trailingSlash: 'always',
  build: { inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
  integrations: [mdx(), sitemap({ filter: (page) => !page.includes('/dev/') })],
  vite: {
    plugins: [tailwindcss()],
    // Pre-bundle three up front so the dev server does not re-optimise it mid-session.
    optimizeDeps: { include: ['three', 'three/webgpu', 'three/tsl', 'lenis', 'nanostores'] },
    worker: { format: 'es' },
    // Never inline assets as data: URIs, so the CSP can keep img-src strict.
    build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 1500 },
  },
});
