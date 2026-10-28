import {createClient} from '@supabase/supabase-js';
import {SUPABASE_URL,SUPABASE_KEY} from './config.js';
import {installSetupPage} from './setup-page.js';
import './setup.css';
const db=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{detectSessionInUrl:false}});
installSetupPage(db,window);
