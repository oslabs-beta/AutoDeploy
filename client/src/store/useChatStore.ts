import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ChatMsg = { role: "user" | "assistant"; text: string };

type ChatState = {
  messages: ChatMsg[];
  input: string;
};

type ChatActions = {
  setInput: (v: string) => void;
  addUser: (text: string) => void;
  addAssistant: (text: string) => void;
  reset: () => void;
};

const intro: ChatMsg = {
  role: "assistant",
  text:
    "Tell me how you want the pipeline. Examples:\n" +
    "• Use Node 20 and pnpm\n" +
    "• Test with vitest; build with pnpm build\n" +
    "• Provide AWS role ARN to deploy with OIDC\n" +
    "I’ll update the fields and regenerate the YAML.",
};

export const useChatStore = create<ChatState & ChatActions>()(
  persist(
    (set, get) => ({
      messages: [intro],
      input: "",
      setInput: (v) => set({ input: v }),
      addUser: (text) => set({ messages: [...get().messages, { role: "user", text }] }),
      addAssistant: (text) => set({ messages: [...get().messages, { role: "assistant", text }] }),
      reset: () => set({ messages: [intro], input: "" }),
    }),
    {
      name: "configure-chat",
      storage: createJSONStorage(() => localStorage),
      // Only persist what matters; easy to version later
      partialize: (s) => ({ messages: s.messages, input: s.input }),
    }
  )
);
