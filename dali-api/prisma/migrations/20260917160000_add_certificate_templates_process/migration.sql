-- Certificate-template background images live in Drive and auto-file into a
-- Core-bound folder via a new lab-wide singleton process type. Additive: adding
-- an enum value leaves existing ProcessFolderBinding rows untouched, and nothing
-- writes 'CertificateTemplates' in this same transaction.
ALTER TYPE "ProcessType" ADD VALUE 'CertificateTemplates';
