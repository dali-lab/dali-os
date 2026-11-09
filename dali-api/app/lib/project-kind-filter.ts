const PROJECT_LIST_OPERATIONS = new Set(["findMany", "findFirst", "count", "aggregate", "groupBy"]);

type Args = { where?: Record<string, unknown> | null } & Record<string, unknown>;

export function isProjectListOperation(model: string | undefined, operation: string): boolean {
  return model === "Project" && PROJECT_LIST_OPERATIONS.has(operation);
}

export function withStandardProjectsOnly(args?: Args | null): Args {
  const base: Args = args ?? {};
  if (base.where && "kind" in base.where) return base;
  return { ...base, where: { ...(base.where ?? {}), kind: "Standard" } };
}
