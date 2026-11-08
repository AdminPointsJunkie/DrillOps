import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {createHandler} from './handler.js';
Deno.serve(createHandler(createClient,(key:string)=>Deno.env.get(key)));
