-- Regrade 17 grammar items that have more than one defensible answer.
--
-- Found after a candidate scored 65 against a 70 pass mark and reported that
-- several questions seemed to have two correct answers. They were right, and it
-- was systemic.
--
-- TWO INDEPENDENT METHODS AGREED. A linguistic audit of the bank, with no access
-- to answer data, flagged 17 of 100 active grammar items. The answer data,
-- checked separately afterwards, shows those 17 fail at 52.3% (195/373) against
-- 26.8% (516/1927) for the other 83 — almost exactly double. A defective item is
-- not the same as a hard item.
--
-- IMPACT: of 113 scored candidates, 45 were failing. 16 of them were failing on
-- these items alone. More than a third of every rejection this test has ever
-- produced.
--
-- THE DEFECT CLASSES:
--  * Collective-noun agreement (British plural vs American singular) — "group of
--    investors ___ made THEIR decision" keyed to "has", which fights the
--    sentence's own pronoun; also team/committee/data. The candidate pool is
--    largely North African, typically schooled in British English, so this
--    penalised a whole cohort for their own standard variety. The bank was also
--    internally inconsistent: "The staff ___ their lunch breaks" is keyed PLURAL.
--  * Tense where both forms are standard — the past perfect is optional when
--    "before" already marks the sequence, and present perfect resists the
--    bounded adjunct in "before lunch today".
--  * Prepositions with two idiomatic options — "due on/by Friday", "postponed
--    until/to next week" (and another item uses "postpone ... to" as correct
--    English in its OWN stem), "proficient in/at/with".
--  * ONE ITEM WAS KEYED TO THE WRONG ANSWER: "___ carefully, the instructions
--    are quite clear" keyed to "Reading" — a dangling participle, since the
--    instructions are not doing the reading. A candidate who knew the rule was
--    marked wrong; one who did not was marked right.
--
-- Credit is ADDITIVE — no candidate loses a mark they already had, including on
-- the inverted item. Matched BY INDEX against the options as candidates actually
-- saw them, which is why this runs BEFORE 00114 changes any question text.
--
-- Applied 2026-08-26. Result: 45 failing -> 29, average 69.7 -> 75.8.
create temporary table _credit(qid uuid, idx int);
insert into _credit(qid, idx) values
  ('2e652139-c548-4da2-aba1-5356bbb8c046',1),  -- team of developers -> "are"
  ('5e1f6eaa-4829-4e0f-a1c7-f90f072f8bc2',0),  -- data from surveys -> "have"
  ('2ce0a5e1-d8b1-4eb0-a7f0-016820bf9d0e',0),  -- committee divided -> "are"
  ('ecb47411-f997-4582-be01-0d9778816cc1',0),  -- group of investors -> "have"
  ('43b58472-20eb-4847-b7ef-890ff5e07672',2),  -- before promoted -> "worked"
  ('49e67795-4e34-4965-8a42-41a059760779',0),  -- by next Friday -> "will complete"
  ('2d3eb82b-01b3-4f88-bd43-ec5203ee6609',0),  -- quarterly results -> "announces"
  ('30166e5c-fd21-4799-8d76-6029c7bb0dc8',1),  -- emails before lunch -> "sent"
  ('9d71137a-6fac-4643-b3d2-dedc8ae5a783',0),  -- password -> "reset"
  ('944a9aa2-7d97-458e-9d1a-3dec55d0b86d',1),  -- accounting -> "worked"
  ('5298264a-ab8d-427a-a478-78dac7abd071',2),  -- by 2025 -> "had hired"
  ('88e29df0-8642-4491-ae89-12e51a61b61b',3),  -- report due -> "by"
  ('c57f5a49-850c-4a7f-ae2c-f24504de2d72',1),  -- postponed -> "to"
  ('cce6dfdd-ea65-458a-bffc-2a4d3dec3d4b',0),  -- proficient -> "at"
  ('cce6dfdd-ea65-458a-bffc-2a4d3dec3d4b',3),  -- proficient -> "with"
  ('8f1a540d-5140-48d4-a2f3-4fc570b87f65',3),  -- deadline falls -> "during"
  ('6ef62855-b2b2-4f1f-805e-10b175195f59',1),  -- instructions -> "Read" (old key was WRONG)
  ('4ebd933f-13cc-4400-bfb1-51e5fd343b7f',0),  -- experienced people -> "who"
  ('4ebd933f-13cc-4400-bfb1-51e5fd343b7f',1);  -- experienced people -> "whom"

update public.candidate_test_answers a
   set is_correct = true
  from _credit c
 where c.qid = a.question_id and c.idx = a.selected_answer and a.is_correct = false;

with s as (
  select a.candidate_id,
         round(100.0 * count(*) filter (where a.is_correct) / count(*))::int as score
  from public.candidate_test_answers a
  join public.english_test_questions q on q.id = a.question_id
  where q.section::text = 'grammar'
  group by a.candidate_id
)
update public.candidates c
   set english_mc_score = s.score
  from s
 where s.candidate_id = c.id and c.english_mc_score is distinct from s.score;

drop table _credit;
