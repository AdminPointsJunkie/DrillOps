import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {publicMapHandler} from './handler.js';
Deno.serve(publicMapHandler(createClient,Deno.env.toObject()));
