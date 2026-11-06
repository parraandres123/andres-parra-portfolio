import {cpSync, mkdirSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outputDir=path.join(projectRoot,'site');

rmSync(outputDir,{recursive:true,force:true});
mkdirSync(outputDir,{recursive:true});
for(const entry of ['index.html','images','fonts']){
  cpSync(path.join(projectRoot,entry),path.join(outputDir,entry),{recursive:true});
}
