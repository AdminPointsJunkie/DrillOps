import {createClient} from '@supabase/supabase-js';
import {SUPABASE_URL,SUPABASE_KEY} from './config.js';
import {installOperatorSignup} from './operator-signup.js';
import './operator-signup.css';
installOperatorSignup({db:createClient(SUPABASE_URL,SUPABASE_KEY)});
