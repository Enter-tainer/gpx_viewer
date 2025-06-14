import { defineConfig } from 'vite';
import { resolve } from 'path';
import * as path from 'path';

// 创建并导出配置，根据命令行参数选择不同的构建目标
export default defineConfig(({ mode }) => {
  // 默认配置
  const baseConfig = {
    resolve: {
      alias: {
        '@': resolve(path.dirname(''), 'src')
      }
    }
  };

  // 根据构建模式选择不同的配置
  if (mode === 'lib') {
    // 库模式配置
    return {
      ...baseConfig,
      build: {
        minify: false,
        lib: {
          entry: resolve(path.dirname(''), 'src/index.ts'),
          name: 'GPXViewer',
          fileName: 'gpx-viewer',
          formats: ['es', 'umd'],
        },
        outDir: './lib',
        emptyOutDir: true,
        cssCodeSplit: false,
        rollupOptions: {
          external: ['maplibre-gl'],
          output: {
            globals: {
              'maplibre-gl': 'maplibregl'
            },
            assetFileNames: 'styles.[ext]'
          }
        }
      }
    };
  } else {
    // 默认为 demo 模式配置
    return {
      ...baseConfig,
      build: {
        minify: false,
        outDir: './dist',
        emptyOutDir: true,
        rollupOptions: {
          input: {
            main: resolve(path.dirname(''), 'index.html')
          },
          output: {
            entryFileNames: 'gpx-viewer.js',
            chunkFileNames: '[name].js',
            assetFileNames: '[name].[ext]'
          }
        },
        cssCodeSplit: false
      }
    };
  }
});