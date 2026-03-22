-- ============================================================
-- StaffVA — English Test Question Bank
-- 100 grammar questions + 5 comprehension questions
-- Run this in the Supabase SQL Editor after 00001 and 00002.
-- ============================================================

-- GRAMMAR QUESTIONS (100 total)
-- Tests: subject-verb agreement, tense, prepositions, sentence structure

INSERT INTO english_test_questions (section, question_text, options, correct_answer, display_order) VALUES

-- Subject-verb agreement (25 questions)
('grammar', 'The team of developers ___ working on the new feature.', '["is", "are", "were", "been"]', 0, 1),
('grammar', 'Neither the manager nor the employees ___ aware of the changes.', '["was", "were", "is", "has been"]', 1, 2),
('grammar', 'Each of the reports ___ been reviewed carefully.', '["have", "has", "are", "were"]', 1, 3),
('grammar', 'The number of applicants ___ increased this quarter.', '["have", "has", "are", "were"]', 1, 4),
('grammar', 'A list of requirements ___ attached to this email.', '["are", "is", "were", "have been"]', 1, 5),
('grammar', 'Every employee and contractor ___ required to sign the agreement.', '["are", "is", "were", "have been"]', 1, 6),
('grammar', 'The data from the surveys ___ been compiled into a report.', '["have", "has", "is", "are"]', 1, 7),
('grammar', 'One of the clients ___ requested a meeting.', '["have", "has", "are", "were"]', 1, 8),
('grammar', 'The committee ___ divided on the issue.', '["are", "is", "were", "has"]', 1, 9),
('grammar', 'All of the information ___ been verified.', '["have", "has", "are", "were"]', 1, 10),
('grammar', 'There ___ several options available for the project.', '["is", "are", "was", "has been"]', 1, 11),
('grammar', 'The quality of the products ___ improved significantly.', '["have", "has", "are", "were"]', 1, 12),
('grammar', 'Mathematics ___ my strongest subject in school.', '["are", "is", "were", "have been"]', 1, 13),
('grammar', 'The CEO, along with the board members, ___ attending the conference.', '["are", "is", "were", "have been"]', 1, 14),
('grammar', 'Five hundred dollars ___ a reasonable price for the service.', '["are", "is", "were", "have been"]', 1, 15),
('grammar', 'The staff ___ their lunch breaks at different times.', '["takes", "take", "taking", "has taken"]', 1, 16),
('grammar', 'Either the supervisor or the assistants ___ responsible for this.', '["is", "are", "was", "has been"]', 1, 17),
('grammar', 'None of the equipment ___ been damaged.', '["have", "has", "are", "were"]', 1, 18),
('grammar', 'The majority of the work ___ completed on time.', '["were", "was", "have been", "are"]', 1, 19),
('grammar', 'Two-thirds of the budget ___ been allocated.', '["have", "has", "is", "are"]', 1, 20),
('grammar', 'News of the merger ___ spreading quickly.', '["are", "is", "were", "have been"]', 1, 21),
('grammar', 'The group of investors ___ made their decision.', '["have", "has", "are", "were"]', 1, 22),
('grammar', 'Everybody in the department ___ completed the training.', '["have", "has", "are", "were"]', 1, 23),
('grammar', 'The United States ___ a major trading partner.', '["are", "is", "were", "have been"]', 1, 24),
('grammar', 'Physics ___ a challenging course for many students.', '["are", "is", "were", "have been"]', 1, 25),

-- Tense (25 questions)
('grammar', 'By the time we arrive, the meeting ___ already started.', '["will have", "would", "has", "is"]', 0, 26),
('grammar', 'She ___ at this company for five years before she got promoted.', '["has worked", "had worked", "worked", "was working"]', 1, 27),
('grammar', 'I ___ the report when my manager called.', '["was writing", "wrote", "have written", "had written"]', 0, 28),
('grammar', 'They ___ the project by next Friday.', '["will complete", "will have completed", "completed", "are completing"]', 1, 29),
('grammar', 'We ___ this software since 2020.', '["use", "used", "have been using", "are using"]', 2, 30),
('grammar', 'The invoice ___ last Tuesday.', '["was sent", "is sent", "has sent", "sends"]', 0, 31),
('grammar', 'By next month, I ___ here for exactly one year.', '["will work", "will have worked", "am working", "have worked"]', 1, 32),
('grammar', 'She realized she ___ the wrong file to the client.', '["sends", "has sent", "had sent", "is sending"]', 2, 33),
('grammar', 'The company ___ its quarterly results tomorrow.', '["announces", "will announce", "announced", "has announced"]', 1, 34),
('grammar', 'While he ___ the contract, the phone rang.', '["reviews", "reviewed", "was reviewing", "has reviewed"]', 2, 35),
('grammar', 'I ___ three emails before lunch today.', '["send", "sent", "have sent", "was sending"]', 2, 36),
('grammar', 'The system ___ automatically every night at midnight.', '["backs up", "backed up", "is backing up", "has backed up"]', 0, 37),
('grammar', 'We ___ the new policy once the CEO approves it.', '["implement", "will implement", "implemented", "have implemented"]', 1, 38),
('grammar', 'She ___ as a paralegal before joining our firm.', '["works", "is working", "has worked", "had worked"]', 3, 39),
('grammar', 'The team ___ on this issue for the past two weeks.', '["works", "worked", "has been working", "is working"]', 2, 40),
('grammar', 'I ___ my password three times already this month.', '["reset", "resetted", "have reset", "was resetting"]', 2, 41),
('grammar', 'After she ___ the presentation, everyone applauded.', '["finishes", "finished", "has finished", "finishing"]', 1, 42),
('grammar', 'They ___ to the new office next week.', '["move", "are moving", "moved", "have moved"]', 1, 43),
('grammar', 'He ___ in accounting for over a decade.', '["works", "worked", "has worked", "is working"]', 2, 44),
('grammar', 'The package ___ by the time we checked the mailroom.', '["arrives", "arrived", "had arrived", "has arrived"]', 2, 45),
('grammar', 'We usually ___ our invoices on the first of the month.', '["sending", "sends", "send", "sent"]', 2, 46),
('grammar', 'The client ___ for a refund yesterday.', '["asks", "asked", "has asked", "is asking"]', 1, 47),
('grammar', 'I ___ to call you back, but I got busy.', '["am going", "was going", "will go", "have gone"]', 1, 48),
('grammar', 'By 2025, the company ___ over 500 employees.', '["hired", "has hired", "had hired", "will have hired"]', 3, 49),
('grammar', 'She ___ the documents when I entered the room.', '["reviews", "reviewed", "was reviewing", "has reviewed"]', 2, 50),

-- Prepositions (25 questions)
('grammar', 'The report is due ___ Friday.', '["in", "on", "at", "by"]', 1, 51),
('grammar', 'We are looking forward ___ hearing from you.', '["in", "for", "to", "at"]', 2, 52),
('grammar', 'She is responsible ___ managing the accounts.', '["of", "for", "to", "with"]', 1, 53),
('grammar', 'The meeting was postponed ___ next week.', '["for", "to", "until", "in"]', 2, 54),
('grammar', 'Please respond ___ this email at your earliest convenience.', '["on", "to", "for", "at"]', 1, 55),
('grammar', 'The documents are ___ the folder on the shared drive.', '["at", "on", "in", "by"]', 2, 56),
('grammar', 'He specializes ___ corporate law.', '["on", "at", "in", "for"]', 2, 57),
('grammar', 'We need to comply ___ the new regulations.', '["to", "with", "for", "by"]', 1, 58),
('grammar', 'The conference will take place ___ March 15.', '["in", "at", "on", "during"]', 2, 59),
('grammar', 'She arrived ___ the office at 8 AM.', '["in", "to", "at", "on"]', 2, 60),
('grammar', 'I will follow up ___ you next week.', '["to", "with", "for", "on"]', 1, 61),
('grammar', 'The contract was signed ___ both parties.', '["from", "with", "by", "for"]', 2, 62),
('grammar', 'We depend ___ our suppliers for raw materials.', '["in", "on", "to", "for"]', 1, 63),
('grammar', 'The payment is overdue ___ 30 days.', '["for", "by", "since", "in"]', 1, 64),
('grammar', 'She is proficient ___ Microsoft Excel.', '["at", "in", "on", "with"]', 1, 65),
('grammar', 'The error resulted ___ a delay in processing.', '["to", "for", "in", "with"]', 2, 66),
('grammar', 'We apologize ___ the inconvenience.', '["about", "for", "of", "to"]', 1, 67),
('grammar', 'The project consists ___ three phases.', '["in", "for", "of", "with"]', 2, 68),
('grammar', 'I agree ___ your assessment of the situation.', '["to", "with", "on", "for"]', 1, 69),
('grammar', 'The deadline falls ___ a holiday this year.', '["in", "at", "on", "during"]', 2, 70),
('grammar', 'They insisted ___ reviewing the terms again.', '["for", "on", "to", "in"]', 1, 71),
('grammar', 'The data was divided ___ three categories.', '["in", "to", "into", "for"]', 2, 72),
('grammar', 'She is committed ___ delivering quality work.', '["for", "to", "in", "with"]', 1, 73),
('grammar', 'The issue was brought ___ during the meeting.', '["out", "in", "up", "on"]', 2, 74),
('grammar', 'We are confident ___ our ability to deliver on time.', '["on", "with", "in", "for"]', 2, 75),

-- Sentence structure (25 questions)
('grammar', 'Which sentence is grammatically correct?', '["The report, which was submitted late, needs revision.", "The report which was submitted late, needs revision.", "The report, which was submitted late needs revision.", "The report which, was submitted late, needs revision."]', 0, 76),
('grammar', '___ the deadline, we managed to submit the proposal.', '["Despite of", "In spite", "Despite", "Although of"]', 2, 77),
('grammar', 'Not only ___ the project on time, but she also stayed under budget.', '["she completed", "did she complete", "she did complete", "completed she"]', 1, 78),
('grammar', 'The manager asked the team ___ the report by Friday.', '["complete", "completing", "to complete", "completed"]', 2, 79),
('grammar', 'If I ___ about the issue earlier, I would have fixed it.', '["know", "knew", "had known", "have known"]', 2, 80),
('grammar', '___ carefully, the instructions are quite clear.', '["Reading", "Read", "Having read", "To read"]', 0, 81),
('grammar', 'The candidate ___ resume we reviewed is highly qualified.', '["who", "whom", "whose", "which"]', 2, 82),
('grammar', 'She asked me ___ I could attend the meeting.', '["that", "whether", "what", "which"]', 1, 83),
('grammar', 'He works ___ efficiently ___ his colleagues.', '["more ... than", "most ... than", "more ... as", "as ... than"]', 0, 84),
('grammar', '___ the heavy workload, the team maintained high morale.', '["Although", "Despite", "However", "Because"]', 1, 85),
('grammar', 'The email ___ I sent yesterday has not been received.', '["who", "whom", "which", "what"]', 2, 86),
('grammar', 'Had the client ___ earlier, we could have prepared better.', '["responded", "respond", "responding", "responds"]', 0, 87),
('grammar', 'It is important that every employee ___ the policy.', '["follows", "follow", "following", "followed"]', 1, 88),
('grammar', 'The more experience you have, ___ your chances of getting hired.', '["the best", "the better", "better", "best"]', 1, 89),
('grammar', 'She suggested ___ the meeting to next week.', '["to postpone", "postponing", "postpone", "postponed"]', 1, 90),
('grammar', 'Neither the proposal ___ the budget has been approved yet.', '["or", "and", "nor", "but"]', 2, 91),
('grammar', 'The reason ___ the delay was a server outage.', '["of", "for", "to", "about"]', 1, 92),
('grammar', '___ you finish the task, please notify your supervisor.', '["Once", "Unless", "Until", "While"]', 0, 93),
('grammar', 'The company, ___ was founded in 2010, has grown rapidly.', '["that", "which", "who", "whom"]', 1, 94),
('grammar', 'I would appreciate it if you ___ send the files today.', '["can", "could", "will", "shall"]', 1, 95),
('grammar', 'The assistant is the person ___ you should direct your questions.', '["to who", "to whom", "who to", "whom"]', 1, 96),
('grammar', '___ submitting the form, please double-check all entries.', '["Before", "After", "While", "Since"]', 0, 97),
('grammar', 'She is one of the most experienced people ___ I have ever worked with.', '["who", "whom", "that", "which"]', 2, 98),
('grammar', 'The task was ___ difficult ___ we needed extra help.', '["such ... that", "so ... that", "too ... that", "very ... that"]', 1, 99),
('grammar', 'We look forward to ___ with you on this project.', '["work", "working", "worked", "works"]', 1, 100);

-- COMPREHENSION QUESTIONS (5 total)
-- Based on the passage in the scope document

INSERT INTO english_test_questions (section, question_text, options, correct_answer, display_order) VALUES

('comprehension', 'What is the main topic of this email?', '["Requesting a new contract", "Following up on a revised contract", "Canceling an agreement", "Scheduling a meeting with legal"]', 1, 1),

('comprehension', 'What happened to the original document?', '["It was lost during transfer", "It included a clause both parties agreed to remove", "It was rejected by the legal department", "It was sent to the wrong client"]', 1, 2),

('comprehension', 'Why has the updated file not been sent yet?', '["The team forgot to send it", "The client has not paid for it", "They are waiting on confirmation from the legal department", "The file was corrupted and needs to be recreated"]', 2, 3),

('comprehension', 'Based on the email, what should happen next?', '["The client should send a new contract", "Someone should follow up with the client about the timeline", "The legal department should cancel the agreement", "The team should start working on a different project"]', 1, 4),

('comprehension', 'What does "shared externally" most likely refer to in this context?', '["Posted on social media", "Sent to people outside the organization", "Saved to a shared drive", "Discussed in an internal meeting"]', 1, 5);
