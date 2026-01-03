import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Custom plugin to strip "use client" and "use server" directives from Radix UI
function stripDirectives(): Plugin {
  return {
    name: 'strip-directives',
    transform(code, id) {
      // Only process node_modules/@radix-ui
      if (!id.includes('node_modules') || !id.includes('@radix-ui')) {
        return null;
      }

      // Strip "use client" and "use server" directives
      const transformed = code
        .replace(/['"]use client['"];?\s*/g, '')
        .replace(/['"]use server['"];?\s*/g, '');

      if (transformed !== code) {
        return { code: transformed, map: null };
      }
      return null;
    }
  };
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'AI Bookmark Brain',
    description: 'AI-powered bookmark summarization and intelligent search',
    version: '0.1.0',
    permissions: [
      'bookmarks',
      'storage',
      'offscreen',
      'activeTab',
      'scripting',
      'tabs',
      'alarms',
      'history',
      'favicon',
    ],
    host_permissions: [
      '<all_urls>',
    ],
    commands: {
      'toggle-search': {
        suggested_key: {
          default: 'Ctrl+Q',
          mac: 'Command+Q',
        },
        description: 'Toggle bookmark search overlay',
      },
    },
    // Required for sql.js WebAssembly to work in production
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  srcDir: 'src',
  vite: () => ({
    plugins: [
      stripDirectives(),
      react()
    ],
  }),
  // Hook to copy sql.js WASM file to output
  hooks: {
    'build:done': async (wxt) => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const wasmSrc = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm');
      const wasmDest = path.resolve(wxt.config.outDir, 'sql-wasm.wasm');

      try {
        await fs.copyFile(wasmSrc, wasmDest);
        console.log('✅ Copied sql-wasm.wasm to output directory');
      } catch (error) {
        console.error('❌ Failed to copy sql-wasm.wasm:', error);
      }
    },
  },
});
