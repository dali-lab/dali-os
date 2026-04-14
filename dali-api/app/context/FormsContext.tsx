import React, { useState, createContext, useContext } from 'react'
import type { ApplicationForm, ApplicationFormVersion } from '~/types'
import { applicationForms as initialForms } from '~/mockData'
interface FormsContextType {
  forms: ApplicationForm[]
  addForm: (form: ApplicationForm) => void
  addVersion: (formId: string, version: ApplicationFormVersion) => void
  deleteForm: (formId: string) => void
}
const FormsContext = createContext<FormsContextType>({
  forms: initialForms,
  addForm: () => {},
  addVersion: () => {},
  deleteForm: () => {},
})
export function useForms() {
  return useContext(FormsContext)
}
export function FormsProvider({ children }: { children: React.ReactNode }) {
  const [forms, setForms] = useState<ApplicationForm[]>(initialForms)
  const addForm = (form: ApplicationForm) => {
    setForms((prev) => [form, ...prev])
  }
  const addVersion = (formId: string, version: ApplicationFormVersion) => {
    setForms((prev) =>
      prev.map((f) =>
        f.id === formId
          ? { ...f, versions: [...f.versions, version] }
          : f,
      ),
    )
  }
  const deleteForm = (formId: string) => {
    setForms((prev) => prev.filter((f) => f.id !== formId))
  }
  return (
    <FormsContext.Provider
      value={{
        forms,
        addForm,
        addVersion,
        deleteForm,
      }}
    >
      {children}
    </FormsContext.Provider>
  )
}
