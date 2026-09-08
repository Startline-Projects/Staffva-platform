-- Remove the length cue from the comprehension bank.
--
-- Measured across the 35 active comprehension items, the correct answer was
-- the strictly longest option in 16 of them: 46% against 25% by chance, exact
-- binomial p = 0.006. Mean key length was 43.3 characters against 39.2 for
-- distractors.
--
-- Why that was not cosmetic. The deal route picks ONE passage uniformly at
-- random from seven and serves its five items, and the option shuffle
-- permutes POSITION but not LENGTH — so the cue survives the shuffle whole.
-- On passage bd17d307 the key was the longest option in 5 of 5 items: a
-- candidate dealt that passage could score 100% on reading by always clicking
-- the longest option, having read no English at all. A candidate dealt
-- 14c547e0 got 1 of 5 from the same heuristic. Comprehension carries weight
-- 0.4, the largest single weight, behind a >= 70 gate — and both candidates
-- paid the same $5, with a fail starting the 3/6/14-day cooldown ladder.
--
-- WHAT THIS CHANGES: distractors only. Every correct answer is byte-identical
-- to what it was, and every correct_answer index is untouched. An independent
-- audit had already verified that every key in this bank is correct and
-- uniquely supported by its passage, so there was nothing to fix about the
-- answers — only about the wrong options being conspicuously shorter.
--
-- Each replacement was written against the passage and then adversarially
-- reviewed for three failure modes: introducing a second defensible answer
-- (the defect that took 17 grammar items out of service), inverting the cue
-- by making the key the SHORTEST option, and substituting a different
-- position-independent giveaway such as the key being the only option with a
-- distinct grammatical shape. Three sets were rejected and rewritten.
--
-- After this migration no key is the strictly longest or strictly shortest
-- option in its item.


-- Why was the section missing from the file?
update public.english_test_questions
   set options = to_jsonb(array['The client asked for the section to be cut', 'The team never finished writing that part', 'It was left in a separate draft document', 'It was accidentally removed during export'])
 where id = '003f06fe-0099-4b6a-98aa-3c7c9a7c1e69'
   and options->>3 = 'It was accidentally removed during export';  -- key must still match, or no row updates

-- According to the email, what does Alex say about the first two Thurs
update public.english_test_questions
   set options = to_jsonb(array['Alex is meeting with the auditors on both of those afternoons', 'The shared calendar shows both of those afternoons are free', 'The recurring invite has already been moved to those two dates', 'Appointments with clients are already scheduled at that time'])
 where id = '25195aeb-5811-48ff-b0e5-030b1ef4182e'
   and options->>3 = 'Appointments with clients are already scheduled at that time';  -- key must still match, or no row updates

-- After Alex and Morgan agree on a new time, what will Morgan most lik
update public.english_test_questions
   set options = to_jsonb(array['Send the auditors an invitation to the new weekly call time', 'Book a meeting room for the new Thursday afternoon call slot', 'Change the repeating calendar invitation to the agreed time', 'Cancel the recurring invite entirely for the rest of the year'])
 where id = 'd76ff8fc-dbb8-4c00-a9a8-fe8a2d6f70a3'
   and options->>2 = 'Change the repeating calendar invitation to the agreed time';  -- key must still match, or no row updates

-- Which of these tasks does the writer say is already finished?
update public.english_test_questions
   set options = to_jsonb(array['Confirming the preferred room type at the hotel', 'Sending the final itinerary to the director', 'Setting up transport to and from the airport', 'Reserving a room at the backup hotel nearby'])
 where id = 'f149fc39-e408-4d2f-955d-8d99ce7f605d'
   and options->>2 = 'Setting up transport to and from the airport';  -- key must still match, or no row updates

-- Based on the message, what will Jordan most likely do next?
update public.english_test_questions
   set options = to_jsonb(array['Wait for the hotel decision before sharing the travel plan', 'Send out the final itinerary to the whole team this afternoon', 'Cancel the director''s place at the conference next week', 'Ask the airline to move the return flight to a later date'])
 where id = 'eede2e39-90e3-4740-9d22-db30a97410ca'
   and options->>0 = 'Wait for the hotel decision before sharing the travel plan';  -- key must still match, or no row updates

-- What is the main purpose of Sam's message?
update public.english_test_questions
   set options = to_jsonb(array['To ask Alex to cancel a design task on the Harborview account', 'To explain an invoice error and how it is being corrected', 'To request that the client pay invoice #2148 this afternoon', 'To introduce the client''s new finance contact to the team'])
 where id = 'd9dcfda5-88f0-4882-b7f5-5a4eb3163022'
   and options->>1 = 'To explain an invoice error and how it is being corrected';  -- key must still match, or no row updates

-- What does the message suggest will happen once the corrected invoice
update public.english_test_questions
   set options = to_jsonb(array['The team will be able to record the client''s payment in the system', 'The client will be asked to pay the original $4,850 invoice amount', 'Accounts will add the canceled design task back to the billing sheet', 'The finance contact will be asked to disregard the corrected invoice'])
 where id = '02199fd6-95a7-4cfa-94bd-5ddb5df39368'
   and options->>0 = 'The team will be able to record the client''s payment in the system';  -- key must still match, or no row updates

-- What is the main purpose of Mira's email?
update public.english_test_questions
   set options = to_jsonb(array['To report that a new employee''s setup has now been fully completed', 'To ask Alex to help finish the last parts of a new employee''s setup', 'To introduce Daniel to the team and list the clients he will support', 'To announce that Daniel''s start date has been delayed by a full week'])
 where id = 'bab7f9e3-d5e5-4243-95f0-7f691c28bdc3'
   and options->>1 = 'To ask Alex to help finish the last parts of a new employee''s setup';  -- key must still match, or no row updates

-- What is the main purpose of this email?
update public.english_test_questions
   set options = to_jsonb(array['To announce the decisions taken at the client meeting', 'To request a rewrite of the March and April reports', 'To ask for a summary document by an earlier deadline', 'To ask Dana to lead the review meeting on Wednesday'])
 where id = 'c9d98957-a987-4567-a9bc-f8577a984a59'
   and options->>2 = 'To ask for a summary document by an earlier deadline';  -- key must still match, or no row updates

-- What will Morgan most likely do after receiving the draft?
update public.english_test_questions
   set options = to_jsonb(array['Read through it before the Wednesday meeting', 'Forward it to the client without reading it', 'Ask the client to switch back to the Friday slot', 'Leave any missing figures blank in the summary'])
 where id = '58258a18-6300-4188-915a-c7e447faa843'
   and options->>0 = 'Read through it before the Wednesday meeting';  -- key must still match, or no row updates

-- What happened to the original document?
update public.english_test_questions
   set options = to_jsonb(array['It was lost after the client transferred the files', 'It included a clause both parties agreed to remove', 'It was rejected by the legal department last Tuesday', 'It was sent to the wrong client before the last call'])
 where id = 'cc0fba59-cf53-41dd-a3c9-136a1191ea4a'
   and options->>1 = 'It included a clause both parties agreed to remove';  -- key must still match, or no row updates

-- Why has the updated file not been sent yet?
update public.english_test_questions
   set options = to_jsonb(array['The team forgot to send it after the last client call', 'The client has not paid the invoice for the revised contract', 'They are waiting on confirmation from the legal department', 'The file was corrupted and needs to be recreated from scratch'])
 where id = '17fdd5c4-8ad4-43e0-8319-b4288fe75d8e'
   and options->>2 = 'They are waiting on confirmation from the legal department';  -- key must still match, or no row updates

-- What does "shared externally" most likely refer to in this context?
update public.english_test_questions
   set options = to_jsonb(array['Posted on the company''s social media pages', 'Sent to people outside the organization', 'Saved to a shared drive the team can open', 'Discussed in an internal team meeting'])
 where id = 'e418870b-97c8-42e4-8af9-a39c3e38c972'
   and options->>1 = 'Sent to people outside the organization';  -- key must still match, or no row updates

-- Why can Alex no longer join the usual 9:00 a.m. call?
update public.english_test_questions
   set options = to_jsonb(array['Alex''s team has a new regular meeting with the auditors', 'Morgan asked to move the weekly call to a later slot', 'Two clients have already booked calls with Alex at 9:00 a.m.', 'The shared calendar no longer shows their usual weekly call'])
 where id = 'a7bc9d16-e8ba-4339-b66e-081a25e41d04'
   and options->>0 = 'Alex''s team has a new regular meeting with the auditors';  -- key must still match, or no row updates

-- What is the main topic of this email?
update public.english_test_questions
   set options = to_jsonb(array['Asking the client for a new contract', 'Following up on a revised contract', 'Canceling an existing agreement', 'Scheduling a review meeting with legal'])
 where id = '62aa53d9-2a77-4d20-9256-6f20937dcb6d'
   and options->>1 = 'Following up on a revised contract';  -- key must still match, or no row updates

-- Based on the email, what should happen next?
update public.english_test_questions
   set options = to_jsonb(array['The client should send over a new version of the contract', 'Someone should follow up with the client about the timeline', 'Someone should ask legal to remove the clause from the file', 'The team should ask the client to resend the original request'])
 where id = 'fd1f8a23-6664-4785-8ea6-c416adcbb2cb'
   and options->>1 = 'Someone should follow up with the client about the timeline';  -- key must still match, or no row updates
