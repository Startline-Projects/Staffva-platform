-- Retire the 17 defective grammar items (see 00113) and insert corrected
-- replacements.
--
-- RETIRE-AND-REPLACE, NOT EDIT-IN-PLACE. candidate_test_answers stores the chosen
-- option as an INDEX into the options array. Rewriting an array silently repoints
-- every historical answer at different text, which would have destroyed the
-- record 00113's regrade depends on. Deactivating preserves exactly what each
-- past candidate saw and chose.
--
-- Must run AFTER 00113 for the same reason.

update public.english_test_questions
   set active = false
 where id in (
   '2e652139-c548-4da2-aba1-5356bbb8c046','5e1f6eaa-4829-4e0f-a1c7-f90f072f8bc2',
   '2ce0a5e1-d8b1-4eb0-a7f0-016820bf9d0e','ecb47411-f997-4582-be01-0d9778816cc1',
   '43b58472-20eb-4847-b7ef-890ff5e07672','49e67795-4e34-4965-8a42-41a059760779',
   '2d3eb82b-01b3-4f88-bd43-ec5203ee6609','30166e5c-fd21-4799-8d76-6029c7bb0dc8',
   '9d71137a-6fac-4643-b3d2-dedc8ae5a783','944a9aa2-7d97-458e-9d1a-3dec55d0b86d',
   '5298264a-ab8d-427a-a478-78dac7abd071','88e29df0-8642-4491-ae89-12e51a61b61b',
   'c57f5a49-850c-4a7f-ae2c-f24504de2d72','cce6dfdd-ea65-458a-bffc-2a4d3dec3d4b',
   '8f1a540d-5140-48d4-a2f3-4fc570b87f65','6ef62855-b2b2-4f1f-805e-10b175195f59',
   '4ebd933f-13cc-4400-bfb1-51e5fd343b7f'
 );

insert into public.english_test_questions (section, question_text, options, correct_answer, display_order, active) values
-- Collective nouns: subject changed so British and American agreement give the
-- SAME answer. The rule under test — agreement across an intervening phrase — is
-- preserved; only the variety ambiguity is removed.
('grammar','The lead developer ___ working on the new feature.','["is","are","were","been"]'::jsonb,0,1,true),
('grammar','The feedback from the surveys ___ been compiled into a report.','["have","has","is","are"]'::jsonb,1,7,true),
('grammar','The committee''s decision ___ final.','["are","is","were","has"]'::jsonb,1,9,true),
('grammar','The group of investors ___ made its decision.','["have","has","are","were"]'::jsonb,1,22,true),

-- Tense: the stem now REQUIRES the keyed form rather than merely preferring it.
('grammar','By the time she got promoted, she ___ at this company for five years.','["has worked","had worked","worked","was working"]'::jsonb,1,27,true),
('grammar','By the time the client review begins next Friday, they ___ the project.','["will complete","will have completed","completed","are completing"]'::jsonb,1,29,true),
('grammar','I ___ three emails so far this morning.','["send","sent","have sent","was sending"]'::jsonb,2,36,true),
('grammar','I ___ my password three times since January.','["reset","resetted","have reset","was resetting"]'::jsonb,2,41,true),
('grammar','He ___ in accounting since 2014.','["works","worked","has worked","is working"]'::jsonb,2,44,true),
-- Also repairs a STALE item: "By 2025" is now in the past, so the future perfect
-- it was keyed to had quietly become the wrong answer on its own.
('grammar','By next year, the company ___ over 500 employees.','["hired","has hired","had hired","will have hired"]'::jsonb,3,49,true),

-- Prepositions: the second idiomatic option replaced with a clearly wrong one.
('grammar','The report is due ___ Friday.','["in","on","at","of"]'::jsonb,1,51,true),
('grammar','The meeting was postponed ___ next week.','["for","since","until","in"]'::jsonb,2,54,true),
('grammar','She is fluent ___ three languages.','["at","in","on","with"]'::jsonb,1,65,true),
('grammar','The deadline falls ___ a public holiday this year.','["in","at","on","to"]'::jsonb,2,70,true),

-- The item whose key was simply WRONG. "Reading carefully, the instructions are
-- quite clear" dangles — the instructions are not doing the reading. Re-keyed to
-- the past participle, which correctly modifies the subject.
('grammar','___ carefully, the instructions are quite clear.','["Reading","Read","Having read","To read"]'::jsonb,1,81,true),

-- Scheduled-future distractor replaced with a non-finite form.
('grammar','The company ___ its quarterly results tomorrow.','["announcing","will announce","announced","has announced"]'::jsonb,1,34,true);

-- NOT REPLACED, retired outright: "She is one of the most experienced people ___
-- I have ever worked with." With a human antecedent, "that", "who" and "whom" are
-- all defensible, and no minimal edit makes it single-answer without changing the
-- rule it tests. Grammar bank: 100 active -> 99.
