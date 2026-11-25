import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
const assets=Object.fromEntries(await Promise.all((await readdir('web')).sort().map(async name=>{
  const type=types[name.split('.').pop()];
  if(!type) throw new Error('Unexpected asset '+name);
  return ['/'+name,{type,body:await readFile('web/'+name,'utf8')}];
})));
const template=await readFile('worker/index.js','utf8');
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await writeFile('dist/server/index.js',template.replace('__ASSETS__',()=>JSON.stringify(assets)));
await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
