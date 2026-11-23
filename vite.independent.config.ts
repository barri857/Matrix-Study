import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  root:fileURLToPath(new URL('./independent',import.meta.url)),
  publicDir:fileURLToPath(new URL('./public',import.meta.url)),
  plugins:[react()],
  define:{'process.env.NEXT_PUBLIC_MATRIX_INDEPENDENT':JSON.stringify('true')},
  resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
  build:{outDir:'../dist-independent/client',emptyOutDir:true},
});
