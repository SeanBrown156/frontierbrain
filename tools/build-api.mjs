// Bundles the hosted API into api/index.mjs for Vercel. Packages with runtime file loading (the Showdown simulator,
// the damage calc) stay external and are traced from node_modules by Vercel.
import {build} from 'esbuild';
await build({entryPoints:['tools/vercel-entry.ts'],outfile:'api/index.mjs',bundle:true,platform:'node',format:'esm',target:'node22',
  external:['pokemon-showdown','@smogon/calc','@supabase/supabase-js','@vercel/functions'],
  banner:{js:"import {createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);"},logLevel:'info'});
