const params=new URLSearchParams(location.hash.slice(1));
if(['invite','recovery'].includes(params.get('type'))||params.has('error')||params.has('error_code')){
 location.replace('/maps/setup.html'+location.search+location.hash);
}else import('./main.js');
