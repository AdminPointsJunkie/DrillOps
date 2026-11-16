import {createClient} from '@supabase/supabase-js';
import {SUPABASE_URL,SUPABASE_KEY} from './config.js';
import {installResetRequest} from './password-controls.js';
import './setup.css';
installResetRequest(createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,detectSessionInUrl:false,flowType:'implicit'}}));
