import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import {defineConfig} from 'vite';

function lucideImportOptimizer() {
  return {
    name: 'lucide-import-optimizer',
    transform(code: string, id: string) {
      if (!id.match(/\.(js|jsx|ts|tsx)$/) || id.includes('node_modules')) {
        return null;
      }

      const toKebabCase = (str: string) => {
        return str
          .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
          .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
          .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
          .toLowerCase();
      };

      let hasChanged = false;
      const cleanCode = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g, (match, p1) => {
        hasChanged = true;
        const cleanP1 = p1
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*/g, '');
        const icons = cleanP1
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        
        return icons
          .map((icon) => {
            const parts = icon.split(/\s+as\s+/);
            const originalIconName = parts[0].trim();
            const aliasName = parts[1] ? parts[1].trim() : originalIconName;
            const kebabName = toKebabCase(originalIconName);
            return `import ${aliasName} from 'lucide-react/dist/esm/icons/${kebabName}.js';`;
          })
          .join('\n');
      });

      if (hasChanged) {
        return {
          code: cleanCode,
          map: null,
        };
      }
      return null;
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), lucideImportOptimizer()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      sourcemap: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 2000,
      minify: 'esbuild' as const,
      cssMinify: true,
      rollupOptions: {
        maxParallelFileOps: 1,
        cache: false,
      }
    },
  };
});
