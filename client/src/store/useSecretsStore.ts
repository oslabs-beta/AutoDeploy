import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type Secrets = {
  SUPABASE_URL: string;
  AWS_ROLE_ARN: string;
  OPENAI_KEY: string;
};

type SecretsState = {
  secrets: Secrets;
};

type SecretsActions = {
  setSecret: <K extends keyof Secrets>(key: K, value: Secrets[K]) => void;
  setSecrets: (all: Partial<Secrets>) => void;
  reset: () => void;
};

const initial: SecretsState = {
  secrets: {
    SUPABASE_URL: "",
    AWS_ROLE_ARN: "",
    OPENAI_KEY: "",
  },
};

export const useSecretsStore = create<SecretsState & SecretsActions>()(
  persist(
    (set) => ({
      ...initial,
      setSecret: (key, value) =>
        set((s) => ({ secrets: { ...s.secrets, [key]: value } })),
      setSecrets: (all) =>
        set((s) => ({ secrets: { ...s.secrets, ...all } })),
      reset: () => set(initial),
    }),
    {
      name: "secrets-store",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
