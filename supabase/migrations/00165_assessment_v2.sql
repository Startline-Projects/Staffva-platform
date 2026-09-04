-- STEP 8, part 2: columns + the open-part bank.
--
-- The MC machinery (ephemeral ids, server-held option permutation,
-- grade-over-served-set — 00122's four properties) is untouched. Open parts
-- ride the same tables: a question row with a null correct_answer is an
-- open item; the attempt stores the candidate's writing text and recording
-- paths; grading fills part_scores. The two candidate score columns keep
-- their meaning (mc = grammar %, comprehension = weighted composite), so
-- every downstream gate, view and RPC reads exactly what it always read.

alter table public.english_test_questions
  alter column options drop not null,
  alter column correct_answer drop not null,
  add column if not exists seconds integer,
  add column if not exists min_words integer,
  add column if not exists max_words integer,
  add column if not exists audio_url text,
  add column if not exists listen_script text;

comment on column public.english_test_questions.listen_script is
  'listening items: the exact text the audio prompt speaks. Grading reference AND the TTS generation source. Never sent to the client.';
comment on column public.english_test_questions.audio_url is
  'listening items: storage path of the generated prompt audio. Item is served only when this is set.';

alter table public.test_attempts
  add column if not exists status text not null default 'created'
    check (status in ('created','submitted','graded','grading_failed')),
  add column if not exists open_answers jsonb,
  add column if not exists recordings jsonb,
  add column if not exists part_scores jsonb,
  add column if not exists graded_at timestamptz;

comment on column public.test_attempts.part_scores is
  'graded per-part results: {grammar, comprehension, read_aloud, listening, speaking, writing, overall, weights} — the dashboard breakdown reads this.';

-- ── The open-part bank (v1: 6 items per part) ──
-- Authoring rules, learned from the defective grammar bank: workplace
-- register, culturally neutral, no BrE/AmE divergence, one defensible
-- reading. question_text is what the candidate sees; read_aloud stores the
-- passage there; listening stores the DISPLAY prompt there and the spoken
-- question in listen_script.

insert into public.english_test_questions (section, question_text, seconds, display_order, active) values
  ('read_aloud', 'Before the meeting starts, please review the updated schedule and let the team know if any of the deadlines look unrealistic to you.', 40, 1, true),
  ('read_aloud', 'Our client asked for a short summary of last month''s results, including what went well and which areas still need attention.', 40, 2, true),
  ('read_aloud', 'The new system saves every document automatically, so you can focus on your work without worrying about losing important changes.', 40, 3, true),
  ('read_aloud', 'If a customer reports a problem, write down the details carefully and confirm you understood the issue before offering a solution.', 40, 4, true),
  ('read_aloud', 'Thank you for joining on short notice; we wanted to walk everyone through the changes before they take effect on Monday.', 40, 5, true),
  ('read_aloud', 'The report covers three topics: current progress, remaining risks, and the support each department needs to finish the project on time.', 40, 6, true);

insert into public.english_test_questions (section, question_text, listen_script, seconds, display_order, active) values
  ('listening', 'Listen to the question, then answer in your own words.', 'Imagine a client emails you saying their order arrived late and they are unhappy. What would you say in your reply?', 40, 1, true),
  ('listening', 'Listen to the question, then answer in your own words.', 'Your manager asks you to take on an urgent task, but you are already busy with another deadline. How would you handle it?', 40, 2, true),
  ('listening', 'Listen to the question, then answer in your own words.', 'A teammate asks you to explain how you organize your work when you have several tasks at once. What would you tell them?', 40, 3, true),
  ('listening', 'Listen to the question, then answer in your own words.', 'You notice a small mistake in a document that has already been sent to a client. What do you do next?', 40, 4, true),
  ('listening', 'Listen to the question, then answer in your own words.', 'A new colleague joins your team and asks what they should know to get started. What would you tell them?', 40, 5, true),
  ('listening', 'Listen to the question, then answer in your own words.', 'Your internet connection fails five minutes before an important video call. What steps do you take?', 40, 6, true);

insert into public.english_test_questions (section, question_text, seconds, display_order, active) values
  ('speaking', 'Describe a project you worked on recently. What was your role, and what did you learn? You have 60 seconds.', 70, 1, true),
  ('speaking', 'Tell us about a time you had to explain something complicated to someone. How did you make it clear? You have 60 seconds.', 70, 2, true),
  ('speaking', 'Describe your ideal working day. How do you organize your time? You have 60 seconds.', 70, 3, true),
  ('speaking', 'Tell us about a piece of feedback you received that helped you improve. You have 60 seconds.', 70, 4, true),
  ('speaking', 'Describe a tool or app you use every day. Why is it useful to you? You have 60 seconds.', 70, 5, true),
  ('speaking', 'Tell us about a time you worked with someone very different from you. How did you make it work? You have 60 seconds.', 70, 6, true);

insert into public.english_test_questions (section, question_text, seconds, min_words, max_words, display_order, active) values
  ('writing', 'Write a short paragraph (100–200 words) about a time you had to solve a problem at work or school. What happened, and what did you do?', 300, 100, 200, 1, true),
  ('writing', 'Write a short email (100–200 words) to a client explaining that a delivery will be two days late, and what you will do about it.', 300, 100, 200, 2, true),
  ('writing', 'Write a short paragraph (100–200 words) describing how you learn a new skill. Give a real example.', 300, 100, 200, 3, true),
  ('writing', 'Write a short message (100–200 words) to your team summarizing the outcome of a meeting they missed.', 300, 100, 200, 4, true),
  ('writing', 'Write a short paragraph (100–200 words) about the working style that suits you best, with an example.', 300, 100, 200, 5, true),
  ('writing', 'Write a short reply (100–200 words) to a customer who asked why your service costs more than a competitor''s.', 300, 100, 200, 6, true);
