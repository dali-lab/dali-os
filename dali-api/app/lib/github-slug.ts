// GitHub team-slug derivation, kept in its own module with NO octokit / Node
// imports so it can be pulled into client bundles (project-create routes render
// on the client). Rule: lowercase, collapse runs of non-alphanumerics to a
// single hyphen, trim leading/trailing hyphens. Returns "" when the name has no
// alphanumeric characters — callers store null in that case.
export function githubTeamSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
