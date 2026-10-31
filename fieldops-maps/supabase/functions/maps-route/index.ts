import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {routeHandler} from './handler.js';
Deno.serve(routeHandler(createClient,Deno.env.toObject()));
