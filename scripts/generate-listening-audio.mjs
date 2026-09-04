// Generates the listening-part prompt audio: every active 'listening'
// question without audio gets its listen_script spoken via ElevenLabs TTS,
// stored in the voice-recordings bucket, and its audio_url stamped. The
// assessment only DEALS listening items that have audio, so running this is
// what switches the listening part on.
//
// Usage:  node scripts/generate-listening-audio.mjs
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// ELEVENLABS_API_KEY. Idempotent — re-running only fills gaps.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim() || process.env[k] || "";

const SUPABASE_URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");
const ELEVEN_KEY = get("ELEVENLABS_API_KEY");
const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — same voice as the interview app

if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Supabase env missing"); process.exit(1); }
if (!ELEVEN_KEY) { console.error("ELEVENLABS_API_KEY missing — add it to .env.local first"); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const { data: rows, error } = await supabase
  .from("english_test_questions")
  .select("id, listen_script")
  .eq("section", "listening")
  .eq("active", true)
  .is("audio_url", null);
if (error) { console.error("query failed:", error.message); process.exit(1); }
if (!rows.length) { console.log("nothing to generate — all listening items have audio"); process.exit(0); }

for (const row of rows) {
  process.stdout.write(`generating ${row.id}… `);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: row.listen_script,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) { console.error(`TTS failed (${res.status}): ${await res.text()}`); process.exit(1); }
  const audio = Buffer.from(await res.arrayBuffer());

  // Random filename: the signed playback URL the client sees must not leak
  // the real question id (an enumeration foothold, however small).
  const path = `assessment-prompts/${crypto.randomUUID()}.mp3`;
  const { error: upErr } = await supabase.storage
    .from("voice-recordings")
    .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (upErr) { console.error(`upload failed: ${upErr.message}`); process.exit(1); }

  const { error: dbErr } = await supabase
    .from("english_test_questions")
    .update({ audio_url: path })
    .eq("id", row.id);
  if (dbErr) { console.error(`stamp failed: ${dbErr.message}`); process.exit(1); }
  console.log(`ok (${Math.round(audio.length / 1024)}KB)`);
}
console.log(`done — ${rows.length} prompt(s) generated. The listening part is live.`);
