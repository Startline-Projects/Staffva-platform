-- STEP 8, part 1: the assessment gains four open-ended section types
-- (Atlas 5-part spec: grammar/comprehension MC stay, plus read-aloud,
-- listen-and-respond, open speaking, and writing). Enum values only —
-- new values can't be USED in the migration that adds them.
alter type test_section_type add value if not exists 'read_aloud';
alter type test_section_type add value if not exists 'listening';
alter type test_section_type add value if not exists 'speaking';
alter type test_section_type add value if not exists 'writing';
