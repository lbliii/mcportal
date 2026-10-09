/** Disposable actual-host probe: synthetic in-memory records, no account link or external fetches.
 * Add this command as an MCP stdio server in the host being tested. Never use as a deployment entrypoint.
 */
import {createInterface} from 'node:readline';
import {resultFixtures} from './benchmark-result-payloads.ts';
import {handleMessage,rpcError,RPC} from '../src/mcp.ts';
const {ctx,fixtures}=await resultFixtures();
ctx.resultMode='component-v1';
console.error('M2 fixture probe ready: all records are synthetic and disappear on restart.');
console.error(JSON.stringify(fixtures.map(({name,tool,args})=>({name,tool,args}))));
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
  if(!line.trim())continue;
  let input:unknown;
  try {input=JSON.parse(line);} catch {process.stdout.write(JSON.stringify(rpcError(null,RPC.parseError,'Parse error'))+'\n');continue;}
  const result=await handleMessage(input,ctx);
  if(result)process.stdout.write(JSON.stringify(result)+'\n');
}
