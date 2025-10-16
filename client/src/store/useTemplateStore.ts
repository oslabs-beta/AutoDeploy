import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type TemplateState = {
  template: "" | "node" | "react" | "python";
  version: string; 
};

type TemplateActions = {
  setTemplate: (t: TemplateState["template"]) => void;
  setVersion: (v: string) => void;
  reset: () => void;
};

const initial: TemplateState = {
  template: "",
  version: "latest",
};

export const useTemplateStore = create<TemplateState & TemplateActions>()(
  persist(
    (set) => ({
      ...initial,
      setTemplate: (t) => set({ template: t }),
      setVersion: (v) => set({ version: v }),
      reset: () => set(initial),
    }),
    {
      name: "template-store",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
