import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Supabase configuration is required");
const db = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const email = "jordan@contour.demo";
let page = 1, found = false;
for (;;) {
  const {data,error} = await db.auth.admin.listUsers({page,perPage:100});
  if(error) throw new Error("Unable to inspect demo accounts");
  if(data.users.some(u=>u.email===email)) { found=true; break; }
  if(data.users.length < 100) break;
  page++;
}
if (!found) {
  const {error} = await db.auth.admin.createUser({email,password:"contour-demo-2026",email_confirm:true,user_metadata:{name:"Jordan Ellis"}});
  if(error) throw new Error("Unable to create the demo consumer");
}
console.log(found ? "Demo consumer already exists." : "Created jordan@contour.demo.");
