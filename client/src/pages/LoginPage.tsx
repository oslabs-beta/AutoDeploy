import { useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { GlassButton } from "@/components/ui/GlassButton";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn, signUp, startGitHubLogin, startGoogleLogin, loading, error } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Log in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            placeholder="password (min 8 chars)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="grid gap-2">
            <GlassButton
              className="w-full"
              disabled={loading}
              onClick={async () => {
                await signIn(email.trim(), password);
                if (useAuthStore.getState().user?.user_id) navigate("/connect");
              }}
            >
              {loading ? "Logging in..." : "Log in"}
            </GlassButton>

            <GlassButton
              className="w-full"
              disabled={loading}
              onClick={async () => {
                await signUp(email.trim(), password);
                if (useAuthStore.getState().user?.user_id) navigate("/connect");
              }}
            >
              {loading ? "Creating account..." : "Create account"}
            </GlassButton>
          </div>

          <div className="pt-4 grid gap-2">
            <GlassButton
              className="w-full"
              disabled={loading}
              onClick={() => startGitHubLogin(`${window.location.origin}/connect`)}
            >
              Continue with GitHub
            </GlassButton>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
