import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const script=readFileSync(new URL('../docs/public-entry.js',import.meta.url),'utf8');
for(const suffix of ['', '#products', '?utm_source=search', '?signin=activities#portal-login', '?return_to=.%2Faccount.html', '#access_token=example&refresh_token=example&type=recovery', '#type=invite&access_token=example', '?code=example']){
 const url=new URL('https://www.drillops.com.au/index.html'+suffix);let target=null;
 vm.runInNewContext(script,{URLSearchParams,location:{search:url.search,hash:url.hash,replace:value=>target=value}});
 const shouldRedirect=/signin|return_to|access_token|code=/.test(suffix);
 assert.equal(target,shouldRedirect?'./eos.html'+suffix:null,suffix);
}
console.log('Public entry: ordinary visits stay public; legacy sign-in and recovery parameters preserved.');
