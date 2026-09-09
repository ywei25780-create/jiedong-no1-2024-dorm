import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({base:'/jiedong-no1-2024-dorm/',plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},css:{postcss:{plugins:[tailwindcss()]}},build:{outDir:'docs',sourcemap:false},server:{host:'127.0.0.1'},preview:{host:'127.0.0.1'}});
