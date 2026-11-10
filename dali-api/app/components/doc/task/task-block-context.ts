import { createContext, useContext } from "react";

const DocProjectContext = createContext<string | null | undefined>(undefined);

export const DocProjectProvider = DocProjectContext.Provider;

/** The doc's project: null for other docs, undefined when the surface doesn't say. */
export function useDocProjectId(): string | null | undefined {
  return useContext(DocProjectContext);
}
