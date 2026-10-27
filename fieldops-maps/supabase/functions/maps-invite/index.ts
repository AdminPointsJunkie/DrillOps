import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {inviteHandler} from './handler.js';
Deno.serve(inviteHandler(createClient,Deno.env.toObject()));
