import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {deleteMapHandler} from './handler.js';
Deno.serve(deleteMapHandler(createClient,Deno.env.toObject()));
