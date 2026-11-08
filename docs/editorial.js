/* Public-site navigation only. Real links work without JavaScript. */
(() => {
 const menu=document.querySelector('.dd-menu'), nav=document.getElementById('product-nav');
 if(!menu||!nav)return;
 const close=()=>{menu.setAttribute('aria-expanded','false');menu.textContent='Menu +';nav.classList.remove('is-open');};
 menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));menu.textContent=open?'Menu −':'Menu +';nav.classList.toggle('is-open',open);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();menu.focus();}});
 document.addEventListener('click',e=>{if(!e.target.closest('.dd-header'))close();});
 matchMedia('(min-width:601px)').addEventListener('change',close);
})();
