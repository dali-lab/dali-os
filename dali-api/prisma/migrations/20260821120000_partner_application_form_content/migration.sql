-- Upgrades the placeholder partner application form (v1 with 4 generic
-- questions) to the real application content (v2 with 35 questions covering
-- project details, existing work, and DALI collaboration context).
--
-- loadPublicForm returns the latest version, so v2 becomes active as soon as
-- this migration runs. The v1 placeholder rows left behind are harmless.
--
-- Idempotent: only inserts v2 when the form exists AND no version >= 2 exists.
INSERT INTO "FormVersion" ("id", "createdAt", "versionNumber", "questions", "intro", "formId", "createdById")
SELECT
    'formver-partner-application-2',
    CURRENT_TIMESTAMP,
    2,
    '[
  {
    "key": "project-title",
    "type": "text",
    "required": true,
    "data": {
      "label": "Project title"
    }
  },
  {
    "key": "contact-name",
    "type": "text",
    "required": true,
    "data": {
      "label": "Main contact name"
    }
  },
  {
    "key": "contact-phone",
    "type": "text",
    "required": true,
    "data": {
      "label": "Main contact phone number"
    }
  },
  {
    "key": "contact-email",
    "type": "text",
    "required": true,
    "data": {
      "label": "Main contact email"
    }
  },
  {
    "key": "legal-entity-name",
    "type": "text",
    "required": true,
    "data": {
      "label": "Legal entity name"
    }
  },
  {
    "key": "legal-entity-address",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Legal entity address"
    }
  },
  {
    "key": "internal-reference",
    "type": "text",
    "required": false,
    "data": {
      "label": "Internal reference",
      "description": "if applicable"
    }
  },
  {
    "key": "team-members",
    "type": "textarea",
    "required": false,
    "data": {
      "label": "Team members"
    }
  },
  {
    "key": "preferred-start-dates",
    "type": "checkbox",
    "required": true,
    "data": {
      "label": "Preferred start dates",
      "options": [
        "No preference",
        "Fall (September start)",
        "Winter (January start)",
        "Spring (April start)"
      ]
    }
  },
  {
    "key": "affiliation",
    "type": "text",
    "required": true,
    "data": {
      "label": "What best describes your affiliation?"
    }
  },
  {
    "key": "website",
    "type": "text",
    "required": false,
    "data": {
      "label": "Website (if applicable)"
    }
  },
  {
    "key": "break-problem",
    "type": "pageBreak",
    "required": false,
    "data": {
      "label": "Part 1: The Problem",
      "description": "Please complete the prompts to the best of your ability. Ideally, answers are 1–2 paragraphs — but the more detail, the better."
    }
  },
  {
    "key": "problem",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Briefly describe the problem you are solving"
    }
  },
  {
    "key": "solution",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "What is your proposed solution(s) / idea?"
    }
  },
  {
    "key": "differentiation",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "How is your project different from other existing similar solutions?"
    }
  },
  {
    "key": "users",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Who will use this product?",
      "description": "Give multiple, specific examples of users and stakeholder groups."
    }
  },
  {
    "key": "impact-who",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Who does your project impact and how?"
    }
  },
  {
    "key": "long-term-impact",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "What do you envision are the long-term impacts of this project?"
    }
  },
  {
    "key": "break-existing",
    "type": "pageBreak",
    "required": false,
    "data": {
      "label": "Part 2: Existing Work"
    }
  },
  {
    "key": "stage",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "At what stage is the project / idea?"
    }
  },
  {
    "key": "user-research",
    "type": "textarea",
    "required": false,
    "data": {
      "label": "Have you spoken with potential users of your solution and researched their needs?",
      "description": "If so, briefly describe your approach and findings, and the most recent user feedback."
    }
  },
  {
    "key": "competitive-research",
    "type": "textarea",
    "required": false,
    "data": {
      "label": "What previous competitive research has been done on the project?",
      "description": "if any"
    }
  },
  {
    "key": "content-data",
    "type": "textarea",
    "required": false,
    "data": {
      "label": "What content or data will your project need? Do you own it? If not, what access do you have?",
      "description": "If it has yet to be created, please describe the plans for creation."
    }
  },
  {
    "key": "timeline",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "What is your project timeline?",
      "description": "Briefly describe your timeline, in particular any go-to-market ideas if applicable."
    }
  },
  {
    "key": "break-collaboration",
    "type": "pageBreak",
    "required": false,
    "data": {
      "label": "Part 3: Collaboration with DALI"
    }
  },
  {
    "key": "why-dali",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Why DALI?"
    }
  },
  {
    "key": "dali-help",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Which aspects of the project would you like to enlist DALI''s help?"
    }
  },
  {
    "key": "funding",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Describe any funding available to you to support this project."
    }
  },
  {
    "key": "how-heard",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "How did you learn about the DALI Lab?"
    }
  },
  {
    "key": "time-pressure",
    "type": "textarea",
    "required": true,
    "data": {
      "label": "Is this project under any time pressure or restrictions?",
      "description": "If so, please explain or provide a hard-stop for DALI''s contribution."
    }
  },
  {
    "key": "anything-else",
    "type": "textarea",
    "required": false,
    "data": {
      "label": "Is there anything else we should know when evaluating this project?"
    }
  },
  {
    "key": "attachments-info",
    "type": "info",
    "required": false,
    "data": {
      "label": "",
      "body": "Attachments (optional). Upload any relevant documents or material that provide further detail or clarity to help us evaluate your application."
    }
  },
  {
    "key": "file-1",
    "type": "file",
    "required": false,
    "data": {
      "label": "File 1"
    }
  },
  {
    "key": "file-2",
    "type": "file",
    "required": false,
    "data": {
      "label": "File 2"
    }
  },
  {
    "key": "file-3",
    "type": "file",
    "required": false,
    "data": {
      "label": "File 3"
    }
  }
]'::jsonb,
    'Thank you for your interest in working with DALI! Please answer the following questions to the best of your ability — detailed answers help us evaluate how the DALI Lab could best work with you. We evaluate projects on five categories: positive social or environmental impact; appropriate and interesting design and development challenges; a passionate and committed founding team; feasibility; and originality / opportunity for innovation. Questions? Email partners@dali.dartmouth.edu.',
    f."id",
    f."createdById"
FROM "Form" f
WHERE f."id" = 'form-partner-application'
  AND NOT EXISTS (
    SELECT 1 FROM "FormVersion" v
    WHERE v."formId" = f."id" AND v."versionNumber" >= 2
  )
ON CONFLICT ("id") DO NOTHING;
