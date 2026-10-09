import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
// WEB_PORT / API_PORT let a second checkout (e.g. a design worktree) run beside the main one.
const web=Number(process.env.WEB_PORT??5173),api=Number(process.env.API_PORT??5174);
export default defineConfig({plugins:[react()],server:{host:'127.0.0.1',port:web,strictPort:true,proxy:{'/api':`http://127.0.0.1:${api}`}},build:{outDir:'dist'}});
