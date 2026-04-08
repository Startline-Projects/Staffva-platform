import { createClient } from "@supabase/supabase-js";
const admin = createClient("https://mshnsbblwgcpwuxwuevp.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data } = await admin.from("candidates")
    .select("full_name, second_interview_status, ai_interview_completed_at, assigned_recruiter")
    .not("assigned_recruiter", "is", null);
  console.table(data?.map(c => ({
    name: c.full_name,
    second_interview_status: c.second_interview_status ?? "NULL",
    ai_done: !!c.ai_interview_completed_at
  })));
}
main().catch(console.error);
