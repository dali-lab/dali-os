import React, { useState, createContext, useContext } from 'react'
import type { Rubric, RubricVersion } from '../../types'
import { rubrics as initialRubrics } from '../../mockData'
interface RubricsContextType {
  rubrics: Rubric[]
  addRubric: (rubric: Rubric) => void
  addRubricVersion: (rubricId: string, version: RubricVersion) => void
}
const RubricsContext = createContext<RubricsContextType>({
  rubrics: initialRubrics,
  addRubric: () => {},
  addRubricVersion: () => {},
})
export function useRubrics() {
  return useContext(RubricsContext)
}
export function RubricsProvider({ children }: { children: React.ReactNode }) {
  const [rubrics, setRubrics] = useState<Rubric[]>(initialRubrics)
  const addRubric = (rubric: Rubric) => {
    setRubrics((prev) => [rubric, ...prev])
  }
  const addRubricVersion = (rubricId: string, version: RubricVersion) => {
    setRubrics((prev) =>
      prev.map((r) =>
        r.id === rubricId
          ? {
              ...r,
              versions: [...r.versions, version],
            }
          : r,
      ),
    )
  }
  return (
    <RubricsContext.Provider
      value={{
        rubrics,
        addRubric,
        addRubricVersion,
      }}
    >
      {children}
    </RubricsContext.Provider>
  )
}
