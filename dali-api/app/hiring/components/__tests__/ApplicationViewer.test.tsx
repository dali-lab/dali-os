import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApplicationViewer } from "../ApplicationViewer";
import type { Question } from "~/types";

const fileQ: Question = {
  key: "resume",
  type: "file",
  required: false,
  data: { label: "Resume" },
};
const ghQ: Question = {
  key: "gh",
  type: "github_url",
  required: false,
  data: { label: "GitHub" },
};
const essayQ: Question = {
  key: "essay",
  type: "textarea",
  required: false,
  data: { label: "Why DALI?" },
};

const presignedUrl =
  "https://s3.example.com/applications/resume/abc-Resume.pdf?X-Amz-Signature=xyz";

describe("ApplicationViewer file/url rendering", () => {
  it("renders file-type general answers as a download link, not an annotatable text field", () => {
    const application = {
      answers: { resume: presignedUrl, essay: "I love building things." },
      generalChallengeVersion: { questions: [fileQ, essayQ] },
      domainApplications: [],
    };

    const html = renderToStaticMarkup(
      createElement(ApplicationViewer, {
        application,
        questionLabels: { resume: "Resume", essay: "Why DALI?" },
      }),
    );

    // The file answer renders as an anchor pointing at the presigned URL,
    // not as an AnnotatableField text node containing the raw key.
    expect(html).toContain(`href="${presignedUrl}"`);
    // AnnotatableField wraps its value in a `select-text cursor-text` div;
    // the file answer should NOT render through that path.
    const fileSection = html.split("Why DALI?")[0];
    expect(fileSection).not.toContain("select-text cursor-text");
    // The textarea answer is still rendered as text via AnnotatableField.
    expect(html).toContain("I love building things.");
  });

  it("renders file-type domain answers as a download link inside the challenge section", () => {
    const application = {
      answers: {},
      generalChallengeVersion: { questions: [] },
      domainApplications: [
        {
          id: "da-1",
          answers: { resume: presignedUrl },
          challengeVersion: {
            questions: [fileQ],
            domain: { name: "Design" },
            challenge: { name: "Design Challenge" },
          },
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(ApplicationViewer, {
        application,
        questionLabels: { resume: "Resume" },
      }),
    );

    expect(html).toContain("Design Challenge".replace(" Challenge", "")); // "Design"
    expect(html).toContain(`href="${presignedUrl}"`);
  });

  it("renders github_url answers as an external link without annotation", () => {
    const application = {
      answers: { gh: "https://github.com/carol/x" },
      generalChallengeVersion: { questions: [ghQ] },
      domainApplications: [],
    };

    const html = renderToStaticMarkup(
      createElement(ApplicationViewer, {
        application,
        questionLabels: { gh: "GitHub" },
      }),
    );

    expect(html).toContain('href="https://github.com/carol/x"');
  });

  it("falls back to AnnotatableField when no question metadata is available for a key", () => {
    // Plain text answers without matching question types should still render
    // (as annotatable text), so reviewers don't lose access to the answer.
    const application = {
      answers: { stray: "some freeform answer" },
      generalChallengeVersion: { questions: [] },
      domainApplications: [],
    };

    const html = renderToStaticMarkup(
      createElement(ApplicationViewer, {
        application,
        questionLabels: { stray: "Stray" },
      }),
    );

    expect(html).toContain("some freeform answer");
    expect(html).toContain("Stray");
  });
});
