import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forwardTool, type ProjectRecord } from '../../src/server/forward';
import { encrypt, decrypt } from '../../src/server/vault';
import { createFakeDb } from '../helpers/fake-db';
import type { FetchJson } from '../../src/server/pinned-fetch';
const project: ProjectRecord = { id: 'project', name: 'Acme', company: 'Acme Inc', mcpResource: 'https://acme.example/api/mcp', asIssuer: 'https://acme.example', tokenEndpoint: 'https://acme.example/oauth/token', revocationEndpoint: null };
const user='consumer';
const response=(status:number,json:unknown)=>({status,json,headers:new Headers()});
const success=response(200,{jsonrpc:'2.0',result:{structuredContent:{value:42},content:[{type:'text',text:'{"value":0}'}]}});
function fixture(expired=false){const refresh=encrypt('secret-refresh'); const access=encrypt('secret-access');return createFakeDb({links:[{contour_user:user,project_id:project.id,status:'active',scopes:['view:read'],refresh_ct:refresh.ct,key_id:refresh.keyId,access_ct:access.ct,access_expires_at:new Date(Date.now()+(expired?-1000:3600000)).toISOString()}]});}
const params={contourUser:user,project,tool:'describe_surface',args:{surfaceId:'ops'}};
const rotated=response(200,{token_type:'Bearer',access_token:'rotated-access',refresh_token:'rotated-refresh',expires_in:3600});
describe('forwardTool',()=>{
 beforeEach(()=>{vi.stubEnv('CLOUD_VAULT_KEY',Buffer.alloc(32,7).toString('base64'));vi.stubEnv('CLOUD_VAULT_KEY_ID','unit');});
 it('uses cached access and sends the bound MCP call',async()=>{const db=fixture();const fetchJson=vi.fn<FetchJson>(async(url,init)=>{expect(url).toBe(project.mcpResource);expect(init.headers).toMatchObject({Authorization:'Bearer secret-access','MCP-Protocol-Version':'2025-11-25',Accept:'application/json','Content-Type':'application/json'});expect(JSON.parse(init.body!)).toMatchObject({jsonrpc:'2.0',method:'tools/call',params:{name:'describe_surface',arguments:{surfaceId:'ops'}}});expect(init.maxBytes).toBe(262144);expect(init.timeoutMs).toBe(8000);return success;});expect(await forwardTool({db,fetchJson,clientId:'https://cloud.example/oauth/client.json'},params)).toEqual({result:{value:42},isError:false});});
 it('refreshes expired access, resource binds and persists encrypted rotation',async()=>{const db=fixture(true);const fetchJson=vi.fn<FetchJson>(async(url,init)=>{if(url===project.tokenEndpoint){expect(new URLSearchParams(init.body)).toEqual(new URLSearchParams({grant_type:'refresh_token',refresh_token:'secret-refresh',client_id:'https://cloud.example/oauth/client.json',resource:project.mcpResource}));return rotated;}expect(init.headers?.Authorization).toBe('Bearer rotated-access');return success;});await forwardTool({db,fetchJson,clientId:'https://cloud.example/oauth/client.json'},params);const row=db.tables.get('links')![0];expect(decrypt(row.refresh_ct,row.key_id)).toBe('rotated-refresh');expect(decrypt(row.access_ct,row.key_id)).toBe('rotated-access');});
 it('refreshes and retries once after a 401',async()=>{const db=fixture();let calls=0;const fetchJson=vi.fn<FetchJson>(async(url)=>url===project.tokenEndpoint?rotated:(++calls===1?response(401,{}):success));expect(await forwardTool({db,fetchJson,clientId:'client'},params)).toMatchObject({isError:false});expect(calls).toBe(2);expect(fetchJson).toHaveBeenCalledTimes(3);});
 it('marks invalid_grant as needs_reconnect without leaking tokens',async()=>{const db=fixture(true);const fetchJson=vi.fn<FetchJson>(async()=>response(400,{error:'invalid_grant',error_description:'secret-refresh secret-access'}));await expect(forwardTool({db,fetchJson,clientId:'client'},params)).rejects.toMatchObject({code:'PROJECT_ACCESS_REVOKED',message:expect.not.stringContaining('secret-')});expect(db.tables.get('links')![0].status).toBe('needs_reconnect');});
 it('maps kill switch while keeping the link active',async()=>{const db=fixture();const fetchJson=vi.fn<FetchJson>(async()=>response(403,{error:{data:{code:'AGENT_ACCESS_DISABLED'},message:'secret-access'}}));await expect(forwardTool({db,fetchJson,clientId:'client'},params)).rejects.toMatchObject({code:'AGENT_ACCESS_DISABLED',message:expect.not.stringContaining('secret-access')});expect(db.tables.get('links')![0].status).toBe('active');});
 it.each([new Error('timeout secret-access'),new Error('socket secret-refresh')])('sanitizes network errors',async(error)=>{const db=fixture();const fetchJson=vi.fn<FetchJson>(async()=>{throw error;});await expect(forwardTool({db,fetchJson,clientId:'client'},params)).rejects.toMatchObject({code:'PROJECT_UNAVAILABLE',message:expect.not.stringContaining('secret-')});});
 it('maps 5xx to unavailable',async()=>{await expect(forwardTool({db:fixture(),fetchJson:async()=>response(503,{}),clientId:'client'},params)).rejects.toMatchObject({code:'PROJECT_UNAVAILABLE'});});
 it('single-flights two concurrent expired access calls',async()=>{const db=fixture(true);let refreshes=0;const fetchJson:FetchJson=async(url)=>{if(url===project.tokenEndpoint){refreshes++;await new Promise(resolve=>setTimeout(resolve,10));return rotated;}return success;};const out=await Promise.all([forwardTool({db,fetchJson,clientId:'client'},params),forwardTool({db,fetchJson,clientId:'client'},params)]);expect(out).toHaveLength(2);expect(refreshes).toBe(1);});
 it('parses text content and preserves project isError',async()=>{expect(await forwardTool({db:fixture(),fetchJson:async()=>response(200,{result:{content:[{type:'text',text:'{"error":{"code":"FORBIDDEN"}}'}],isError:true}}),clientId:'client'},params)).toEqual({result:{error:{code:'FORBIDDEN'}},isError:true});});
 it('rejects second 401 without a refresh loop',async()=>{let refreshes=0;const db=fixture();const fetchJson:FetchJson=async(url)=>{if(url===project.tokenEndpoint){refreshes++;return rotated;}return response(401,{});};await expect(forwardTool({db,fetchJson,clientId:'client'},params)).rejects.toMatchObject({code:'PROJECT_ACCESS_REVOKED'});expect(refreshes).toBe(1);expect(db.tables.get('links')![0].status).toBe('needs_reconnect');});
 it('rejects malformed token response without storing token data',async()=>{const db=fixture(true);const previous=db.tables.get('links')![0].refresh_ct;await expect(forwardTool({db,fetchJson:async()=>response(200,{access_token:'secret-access',expires_in:'oops'}),clientId:'client'},params)).rejects.toMatchObject({code:'PROJECT_UNAVAILABLE'});expect(db.tables.get('links')![0].refresh_ct).toBe(previous);});
 it('claims refresh_ct before network so independent process maps do not reuse a token',async()=>{
   vi.resetModules();
   const {forwardTool:otherProcess}=await import('../../src/server/forward');
   const db=fixture(true);let refreshes=0;
   const fetchJson:FetchJson=async(url)=>{if(url===project.tokenEndpoint){refreshes++;expect(db.tables.get('links')![0].refresh_ct).toMatch(/^refreshing:/);await new Promise(resolve=>setTimeout(resolve,15));return rotated;}return success;};
   await Promise.all([forwardTool({db,fetchJson,clientId:'client'},params),otherProcess({db,fetchJson,clientId:'client'},params)]);
   expect(refreshes).toBe(1);expect(decrypt(db.tables.get('links')![0].refresh_ct,'unit')).toBe('rotated-refresh');
 });
 it('does not overwrite a re-linked grant after invalid_grant for an old refresh',async()=>{
   const db=fixture(true);const fetchJson:FetchJson=async(url)=>{if(url===project.tokenEndpoint){const row=db.tables.get('links')![0];row.refresh_ct=encrypt('new-grant-refresh').ct;row.access_ct=encrypt('new-grant-access').ct;row.access_expires_at=new Date(Date.now()+3600000).toISOString();return response(400,{error:'invalid_grant'});}return success;};
   await forwardTool({db,fetchJson,clientId:'client'},params);
   const row=db.tables.get('links')![0];expect(row.status).toBe('active');expect(decrypt(row.refresh_ct,row.key_id)).toBe('new-grant-refresh');
 });
 it('fails closed on an abandoned cross-process refresh claim',async()=>{
   const db=fixture(true);db.tables.get('links')![0].refresh_ct='refreshing:'+ (Date.now()-31000)+':abandoned';
   const fetchJson=vi.fn<FetchJson>(async()=>success);
   await expect(forwardTool({db,fetchJson,clientId:'client'},params)).rejects.toMatchObject({code:'PROJECT_ACCESS_REVOKED'});
   expect(fetchJson).not.toHaveBeenCalled();expect(db.tables.get('links')![0].status).toBe('needs_reconnect');
 });

});
