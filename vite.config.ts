import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';


export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Support multiple env names so Vercel/any host works (VITE_ prefix is standard for client exposure)
    const geminiKey = env.VITE_GEMINI_API_KEY || env.VITE_Gemini_API_KEY
      || env.GEMINI_API_KEY || env.Gemini_API_KEY
      || process.env.VITE_GEMINI_API_KEY || process.env.VITE_Gemini_API_KEY
      || process.env.GEMINI_API_KEY || process.env.Gemini_API_KEY || '';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      
      define: {
        'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
        'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY || ''),
        'process.env.GOOGLE_API_KEY': JSON.stringify(env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || ''),
        'import.meta.env.VITE_DEPLOY_SHA': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : (process.env.VITE_DEPLOY_SHA || 'dev'))
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
