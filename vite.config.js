import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

// https://vite.dev/config/
export default defineConfig({
  server: { proxy: {
    ...(process.env.CLOUDPEAK_DATA_PROXY_TARGET ? { '/railway-api': { target: process.env.CLOUDPEAK_DATA_PROXY_TARGET, rewrite: path => path.replace(/^\/railway-api/, '') } } : {}),
    ...(process.env.CLOUDPEAK_STORAGE_PROXY_TARGET ? { '/railway-storage': { target: process.env.CLOUDPEAK_STORAGE_PROXY_TARGET, rewrite: path => path.replace(/^\/railway-storage/, '') } } : {}),
  } },
  plugins: [react()],
})
