// Vercel function entry. The real server is bundled into build/api/server.mjs by `node tools/build-api.mjs`
// during the Vercel build (see vercel.json); this file stays tiny so Vercel can detect the function up front.
export {default} from '../build/api/server.mjs';
