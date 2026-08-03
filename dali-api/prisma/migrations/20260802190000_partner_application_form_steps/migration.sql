-- Replace the seeded partner application form with the multi-step port of
-- DALI's external application (General / The Problem / Existing Work /
-- Collaboration with DALI). Account-first: no main-contact name/email (from the
-- account) and no legal entity (contract paperwork). Mirrors
-- app/partners/lib/default-application-form.ts. Only touches the seeded form
-- (id 'form-partner-application'); Core edits after this are preserved on
-- subsequent deploys because migrations run once.
UPDATE "FormVersion"
SET questions = '[
  {"key":"affiliation","type":"select","required":true,"data":{"label":"What best describes your affiliation?","options":["Startup","Nonprofit","Dartmouth faculty or department","Established company","Individual","Other"],"step":1,"stepTitle":"General"}},
  {"key":"preferred_start","type":"select","required":false,"data":{"label":"Preferred start","description":"Most projects span two 10-week terms. No preference is fine.","options":["No preference","Fall (September)","Winter (January)","Spring (April)"],"step":1}},
  {"key":"team_members","type":"textarea","required":false,"data":{"label":"Who else is on your team?","description":"Names and roles of anyone else we''d be working with.","step":1}},
  {"key":"phone","type":"text","required":false,"data":{"label":"Phone number (optional)","step":1}},
  {"key":"website","type":"text","required":false,"data":{"label":"Website (optional)","step":1}},
  {"key":"referral","type":"text","required":false,"data":{"label":"How did you hear about the DALI Lab?","step":1}},
  {"key":"problem","type":"textarea","required":true,"data":{"label":"Briefly describe the problem you are solving","step":2,"stepTitle":"The Problem"}},
  {"key":"solution","type":"textarea","required":true,"data":{"label":"What is your proposed solution or idea?","step":2}},
  {"key":"differentiation","type":"textarea","required":true,"data":{"label":"How is your project different from existing solutions?","step":2}},
  {"key":"users","type":"textarea","required":true,"data":{"label":"Who will use this product?","description":"Give multiple, specific examples of users and stakeholders.","step":2}},
  {"key":"impact","type":"textarea","required":true,"data":{"label":"Who does your project impact, and how?","step":2}},
  {"key":"long_term_impact","type":"textarea","required":true,"data":{"label":"What are the long-term impacts you envision?","step":2}},
  {"key":"stage","type":"textarea","required":true,"data":{"label":"At what stage is the project or idea?","step":3,"stepTitle":"Existing Work"}},
  {"key":"user_research","type":"textarea","required":false,"data":{"label":"Have you spoken with potential users and researched their needs?","description":"If so, briefly describe your approach and what you learned.","step":3}},
  {"key":"competitive_research","type":"textarea","required":false,"data":{"label":"What competitive research has been done, if any?","step":3}},
  {"key":"content_data","type":"textarea","required":false,"data":{"label":"What content or data will your project need? Do you own it?","description":"If it doesn''t exist yet, describe how it would be created.","step":3}},
  {"key":"timeline","type":"textarea","required":true,"data":{"label":"What is your project timeline?","description":"Include any go-to-market plans if applicable.","step":3}},
  {"key":"why_dali","type":"textarea","required":true,"data":{"label":"Why DALI?","step":4,"stepTitle":"Collaboration with DALI"}},
  {"key":"help_areas","type":"textarea","required":true,"data":{"label":"Which aspects of the project would you like DALI''s help with?","step":4}},
  {"key":"funding","type":"textarea","required":true,"data":{"label":"Describe any funding available to support this project.","description":"Partnership fees pay the students and mentors on your team.","step":4}},
  {"key":"time_pressure","type":"textarea","required":true,"data":{"label":"Is this project under any time pressure or restrictions?","description":"If so, please explain or give a hard stop.","step":4}},
  {"key":"anything_else","type":"textarea","required":false,"data":{"label":"Anything else we should know when evaluating this project?","step":4}},
  {"key":"attachments","type":"file","required":false,"data":{"label":"Attachments (optional)","description":"Any documents or material that help us evaluate your application.","accept":".pdf,.doc,.docx,.png,.jpg,.jpeg","step":4}}
]'::jsonb
WHERE "formId" = 'form-partner-application';
