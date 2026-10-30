import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installSidebarToggle} from '../src/sidebar-toggle.js';
test('layers reopen with either control and survive desktop/mobile breakpoint changes',()=>{
 const doc=new JSDOM('<aside id="sidebar"></aside><button id="toggle"></button><button id="collapse"></button><button id="reopen"></button>').window.document;
 let changed;const media={matches:false,addEventListener:(_,fn)=>changed=fn},win={matchMedia:()=>media,requestAnimationFrame:fn=>fn()};
 const [sidebar,toggle,collapse,reopen]=['sidebar','toggle','collapse','reopen'].map(id=>doc.getElementById(id));
 installSidebarToggle({sidebar,toggle,collapse,reopen,win,onResize(){}});
 collapse.click();assert.equal(reopen.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'false');
 media.matches=true;changed();toggle.click();assert.equal(doc.body.classList.contains('layers-collapsed'),false);assert.equal(sidebar.classList.contains('mobile-open'),true);
 collapse.click();reopen.click();assert.equal(reopen.hidden,true);assert.equal(sidebar.classList.contains('mobile-open'),true);
 media.matches=false;changed();assert.equal(doc.body.classList.contains('layers-collapsed'),false);assert.equal(sidebar.classList.contains('mobile-open'),false);
 toggle.click();reopen.click();assert.equal(toggle.getAttribute('aria-expanded'),'true');
});
