import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type DeployState = {
  roles: string[];
  selectedRole: string;
  deploymentStatus: "" | "idle" | "deploying" | "success" | "error";
};

type DeployActions = {
  setRoles: (roles: string[]) => void;
  setSelectedRole: (arn: string) => void;
  setDeploymentStatus: (s: DeployState["deploymentStatus"]) => void;
  reset: () => void;
};

const initial: DeployState = {
  roles: [],
  selectedRole: "",
  deploymentStatus: "",
};

export const useDeployStore = create<DeployState & DeployActions>()(
  persist(
    (set) => ({
      ...initial,
      setRoles: (roles) => set({ roles }),
      setSelectedRole: (arn) => set({ selectedRole: arn }),
      setDeploymentStatus: (s) => set({ deploymentStatus: s }),
      reset: () => set(initial),
    }),
    {
      name: "deploy-store",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
