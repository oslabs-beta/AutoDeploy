// client/src/pages/ConfigurePage.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { usePipelineStore } from "../store/usePipelineStore";
import { useChatStore } from "../store/useChatStore";
import { parseChatForPipeline, summarizeChanges } from "@/lib/aiAssist";
import { GlassButton } from "@/components/ui/GlassButton";


const STAGES = ["build", "test", "deploy"] as const;

export default function ConfigurePage() {
  const { repo, branch } = useRepoStore();
  const pipeline = usePipelineStore();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // Chat (persisted via Zustand)
  const messages = useChatStore((s) => s.messages);
  const input = useChatStore((s) => s.input);
  const setInput = useChatStore((s) => s.setInput);
  const addUser = useChatStore((s) => s.addUser);
  const addAssistant = useChatStore((s) => s.addAssistant);
  const resetChat = useChatStore.getState().reset;

  useEffect(() => {
    if (!repo || !branch) return;
    pipeline.loadAwsRoles?.().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function regenerateNow() {
    if (!repo || !branch) return;
    setBusy(true);
    try {
      await pipeline.regenerate?.({ repo, branch });
    } finally {
      setBusy(false);
    }
  }

  async function onSendChat(e?: React.FormEvent) {
    e?.preventDefault();
    const message = input.trim();
    if (!message) return;

    addUser(message);
    setInput("");

    const changes = parseChatForPipeline(message);
    if (changes.nodeVersion) pipeline.setOption?.("nodeVersion", changes.nodeVersion);
    if (changes.installCmd) pipeline.setOption?.("installCmd", changes.installCmd);
    if (changes.testCmd) pipeline.setOption?.("testCmd", changes.testCmd);
    if (changes.buildCmd) pipeline.setOption?.("buildCmd", changes.buildCmd);
    if (changes.awsRoleArn) pipeline.setOption?.("awsRoleArn", changes.awsRoleArn);

    await regenerateNow();
    addAssistant(summarizeChanges(changes));
  }

  return (
    <section className="grid gap-4 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Configure Pipeline</h1>
        <div className="text-sm opacity-70">
          {repo && branch ? (
            <>
              <span className="font-mono">{repo}</span>@<span className="font-mono">{branch}</span>
            </>
          ) : (
            <span className="text-orange-700">Pick a repo/branch on Connect first.</span>
          )}
        </div>
      </div>

      {/* Provider */}
      <label className="space-y-2">
        <div className="font-medium">Provider</div>
        <select
          value={pipeline.provider}
          onChange={(e) => pipeline.setProvider?.(e.target.value as "aws" | "jenkins")}
          className="block rounded-md border px-3 py-2"
        >
          <option value="aws">AWS (OIDC)</option>
          <option value="jenkins">Jenkins</option>
        </select>
      </label>
      {/* Template */}
      <label className="space-y-2">
        <div className="font-medium">Template</div>
        <select
          value={pipeline.template ?? "node_app"}
          onChange={(e) => pipeline.setTemplate?.(e.target.value)}
          className="block rounded-md border px-3 py-2"
        >
          <option value="node_app">Node.js</option>
          {/* add more templates here */}
        </select>
      </label>

      {/* Stages */}
      <div>
        <div className="font-medium mb-1">Stages</div>
        <div className="flex gap-4">
          {STAGES.map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!pipeline.stages?.includes(s)}
                onChange={() => pipeline.toggleStage?.(s)}
              />
              {s}
            </label>
          ))}
        </div>
      </div>

      {/* ====== AI Chat Assist (persisted) ====== */}
      <div className="grid gap-2">
        <div className="text-sm font-medium">
          Chat with AI about Node version, install/test/build commands, and AWS role
        </div>

        {/* history */}
        <div className="rounded-lg bg-white/10 backdrop-blur-md p-3 max-h-64 overflow-auto border border-white/20 text-slate-100">
          {messages.map((m, i) => (
            <div key={i} className={`my-2 ${m.role === "user" ? "text-right" : ""}`}>
              <span
  className={`inline-block rounded px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
    m.role === "user"
      ? "bg-white/20 text-slate-100"
      : "bg-white/10 border border-white/20 text-slate-200"
  }`}
>
  {m.text}
</span>
            </div>
          ))}
        </div>

        {/* examples */}
        <div className="flex flex-wrap gap-2 text-xs">
          {[
            "Use Node 20, pnpm; test with vitest; build with pnpm build",
            "Node 18; npm ci; npm test; npm run build",
            "role arn:aws:iam::123456789012:role/app-ci",
          ].map((ex) => (
            <GlassButton
              key={ex}
              type="button"
              onClick={() => setInput(ex)}
              className="rounded-full border bg-white px-3 py-1 hover:bg-gray-50"
            >
              {ex}
            </GlassButton>
          ))}
        </div>

        {/* input */}
        <form onSubmit={onSendChat} className="grid gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g., Use Node 20 and pnpm. Test with vitest. Build with pnpm build. Role arn:aws:iam::123...:role/ci"
            className="rounded-md border px-3 py-2 min-h-[110px] text-[0.95rem]"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") onSendChat(e);
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs opacity-70">Press ⌘/Ctrl + Enter to send</span>
            <div className="flex gap-2">
              <GlassButton
                type="button"
                onClick={() => {
                  // optional clear-chat button
                  const resetChat = useChatStore.getState().reset;
                  // TS-friendly: import at top if you prefer
                }}
                className="rounded-md border px-3 py-2 bg-white hidden"
              >
                Clear
              </GlassButton>
              <GlassButton
                type="submit"
                disabled={busy}
                className="rounded-md border px-4 py-2 bg-white"
              >
                {busy ? "…" : "Send"}
              </GlassButton>
            </div>
          </div>
        </form>
      </div>

      {pipeline.provider === "aws" && (
        <>
        {/* ====== Options (auto-updated by chat) ====== */}
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Node version</span>
            <input
              value={pipeline.options?.nodeVersion ?? ""}
              onChange={(e) => pipeline.setOption?.("nodeVersion", e.target.value)}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Install command</span>
            <input
              value={pipeline.options?.installCmd ?? ""}
              onChange={(e) => pipeline.setOption?.("installCmd", e.target.value)}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Test command</span>
            <input
              value={pipeline.options?.testCmd ?? ""}
              onChange={(e) => pipeline.setOption?.("testCmd", e.target.value)}
              className="rounded-md border px-3 py-2"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Build command</span>
            <input
              value={pipeline.options?.buildCmd ?? ""}
              onChange={(e) => pipeline.setOption?.("buildCmd", e.target.value)}
              className="rounded-md border px-3 py-2"
            />
          </label>
        </div>

        {/* ====== AWS Role ====== */}
        <label className="grid gap-1">
          <span className="text-sm font-medium">AWS Role (OIDC)</span>
          <select
            disabled={busy}
            value={pipeline.options?.awsRoleArn ?? ""}
            onChange={(e) => pipeline.setOption?.("awsRoleArn", e.target.value)}
            className="rounded-md border px-3 py-2 text-white bg-black"
          >
            <option value="">-- select --</option>
            {pipeline.roles?.map((r: any) => (
              <option key={r.arn} value={r.arn}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        </>
      )}

      {/* ====== Actions ====== */}
      <div className="flex gap-3">
        <GlassButton
          onClick={regenerateNow}
          disabled={busy}
          className="rounded-md border px-4 py-2 bg-white"
        >
          {busy ? "Generating…" : "Generate Pipeline"}
        </GlassButton>
        <GlassButton
          onClick={() => navigate("/secrets")}
          disabled={
            !(
              pipeline.result?.yaml ||
              (pipeline.result as any)?.generated_yaml ||
              (pipeline.result as any)?.data?.generated_yaml
            )
          }
          className="rounded-md border px-4 py-2 bg-white"
        >
          Continue → Secrets
        </GlassButton>
      </div>

      {/* ====== YAML Preview ====== */}
      <div>
        <div className="text-sm font-medium mb-1">YAML Preview</div>
        <pre className="max-h-96 overflow-auto bg-[#131212ff] text-gray-100 rounded-lg p-3">
{String(
  pipeline.result?.yaml ??
  (pipeline.result as any)?.generated_yaml ??
  (pipeline.result as any)?.data?.generated_yaml ??
  "Click Generate Pipeline or use the chat to update & regenerate…"
)}
        </pre>
      </div>
    </section>
  );
}

// // client/src/pages/ConfigurePage.tsx
// import { useEffect, useState } from "react";
// import { useNavigate } from "react-router-dom";
// import { useRepoStore } from "../store/useRepoStore";
// import { usePipelineStore } from "../store/usePipelineStore";
// import { parseChatForPipeline, summarizeChanges } from "../lib/aiAssist";

// type ChatMsg = { role: "user" | "assistant"; text: string };

// export default function ConfigurePage() {
//   const { repo, branch } = useRepoStore();
//   const pipeline = usePipelineStore();
//   const navigate = useNavigate();

//   useEffect(() => {
//     if (!repo || !branch) return;
//     // load AWS roles once
//     pipeline.loadAwsRoles?.().catch(console.error);
//   }, [repo, branch, pipeline]);

//   const [busy, setBusy] = useState(false);
//   const [chatInput, setChatInput] = useState("");
//   const [chat, setChat] = useState<ChatMsg[]>([
//     {
//       role: "assistant",
//       text:
//         "Tell me how you want the pipeline. Examples:\n" +
//         "• Use Node 20 and pnpm\n" +
//         "• Test with vitest, build with npm run build\n" +
//         "• Use this AWS role ARN: arn:aws:iam::123456789012:role/app-ci\n" +
//         "I’ll update the form and regenerate the YAML.",
//     },
//   ]);

//   async function regenerateNow() {
//     if (!repo || !branch) return;
//     setBusy(true);
//     try {
//       await pipeline.regenerate({ repo, branch });
//     } finally {
//       setBusy(false);
//     }
//   }

//   async function onSendChat(e?: React.FormEvent) {
//     e?.preventDefault();
//     const message = chatInput.trim();
//     if (!message) return;

//     // 1) show user message
//     setChat((c) => [...c, { role: "user", text: message }]);
//     setChatInput("");

//     // 2) parse & apply changes to the pipeline store
//     const changes = parseChatForPipeline(message);
//     const { options } = usePipelineStore.getState();

//     if (changes.nodeVersion)
//       pipeline.setOption("nodeVersion", changes.nodeVersion);
//     if (changes.installCmd) pipeline.setOption("installCmd", changes.installCmd);
//     if (changes.testCmd) pipeline.setOption("testCmd", changes.testCmd);
//     if (changes.buildCmd) pipeline.setOption("buildCmd", changes.buildCmd);
//     if (changes.awsRoleArn) pipeline.setOption("awsRoleArn", changes.awsRoleArn);

//     // 3) regenerate YAML
//     await regenerateNow();

//     // 4) assistant summary
//     const summary = summarizeChanges(changes);
//     setChat((c) => [...c, { role: "assistant", text: summary }]);
//   }

//   return (
//     <section className="grid gap-4 p-6 max-w-5xl mx-auto">
//       <h1 className="text-2xl font-semibold">Configure Pipeline</h1>
//       <div className="text-sm opacity-70">{repo}@{branch}</div>

//       {/* ====== Template & Stages ====== */}
//       <label className="space-y-2">
//         <div className="font-medium">Template</div>
//         <select
//           value={pipeline.template}
//           onChange={(e) => pipeline.setTemplate?.(e.target.value)}
//           className="block rounded-md border px-3 py-2"
//         >
//           <option value="node_app">Node.js</option>
//           {/* add more when ready */}
//         </select>
//       </label>

//       <div>
//         <div className="font-medium mb-1">Stages</div>
//         <div className="flex gap-4">
//           {(["build", "test", "deploy"] as const).map((s) => (
//             <label key={s} className="flex items-center gap-2">
//               <input
//                 type="checkbox"
//                 checked={pipeline.stages.includes(s)}
//                 onChange={() => pipeline.toggleStage(s)}
//               />
//               {s}
//             </label>
//           ))}
//         </div>
//       </div>

//       {/* ====== AI Chat Assist ====== */}
// <div className="grid gap-2">
//   <div className="text-sm font-medium">
//     Chat with AI about Node version, install/test/build commands, and AWS role
//   </div>

//   {/* history */}
//   <div className="rounded-lg bg-gray-100/60 p-3 max-h-64 overflow-auto">
//     {chat.map((m, i) => (
//       <div key={i} className={`my-2 ${m.role === "user" ? "text-right" : ""}`}>
//         <span
//           className={`inline-block rounded px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
//             m.role === "user" ? "bg-black text-white" : "bg-white border"
//           }`}
//         >
//           {m.text}
//         </span>
//       </div>
//     ))}
//   </div>

//   {/* examples */}
//   <div className="flex flex-wrap gap-2 text-xs">
//     {[
//       "Use Node 20, pnpm; test with vitest; build with pnpm build",
//       "Node 18; npm ci; npm test; npm run build",
//       "role arn:aws:iam::123456789012:role/app-ci",
//     ].map((ex) => (
//       <button
//         key={ex}
//         type="button"
//         onClick={() => setChatInput(ex)}
//         className="rounded-full border bg-white px-3 py-1 hover:bg-gray-50"
//       >
//         {ex}
//       </button>
//     ))}
//   </div>

//   {/* big input */}
//   <form onSubmit={onSendChat} className="grid gap-2">
//     <textarea
//       value={chatInput}
//       onChange={(e) => setChatInput(e.target.value)}
//       placeholder="e.g., Use Node 20 and pnpm. Test with vitest. Build with pnpm build. Role arn:aws:iam::123...:role/ci"
//       className="rounded-md border px-3 py-2 min-h-[110px] text-[0.95rem]"
//       onKeyDown={(e) => {
//         if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
//           onSendChat(e);
//         }
//       }}
//     />
//     <div className="flex items-center justify-between">
//       <span className="text-xs opacity-70">Press ⌘/Ctrl + Enter to send</span>
//       <button
//         type="submit"
//         disabled={busy}
//         className="rounded-md border px-4 py-2 bg-white"
//       >
//         {busy ? "…" : "Send"}
//       </button>
//     </div>
//   </form>
// </div>


//       {/* ====== Options (auto-updated by chat) ====== */}
//       <div className="grid gap-3">
//         <label className="grid gap-1">
//           <span className="text-sm font-medium">Node version</span>
//           <input
//             value={pipeline.options.nodeVersion}
//             onChange={(e) => pipeline.setOption("nodeVersion", e.target.value)}
//             className="rounded-md border px-3 py-2"
//           />
//         </label>
//         <label className="grid gap-1">
//           <span className="text-sm font-medium">Install command</span>
//           <input
//             value={pipeline.options.installCmd}
//             onChange={(e) => pipeline.setOption("installCmd", e.target.value)}
//             className="rounded-md border px-3 py-2"
//           />
//         </label>
//         <label className="grid gap-1">
//           <span className="text-sm font-medium">Test command</span>
//           <input
//             value={pipeline.options.testCmd}
//             onChange={(e) => pipeline.setOption("testCmd", e.target.value)}
//             className="rounded-md border px-3 py-2"
//           />
//         </label>
//         <label className="grid gap-1">
//           <span className="text-sm font-medium">Build command</span>
//           <input
//             value={pipeline.options.buildCmd}
//             onChange={(e) => pipeline.setOption("buildCmd", e.target.value)}
//             className="rounded-md border px-3 py-2"
//           />
//         </label>
//       </div>

//       {/* ====== AWS Role ====== */}
//       <label className="grid gap-1">
//         <span className="text-sm font-medium">AWS Role (OIDC)</span>
//         <select
//           disabled={busy}
//           value={pipeline.options.awsRoleArn ?? ""}
//           onChange={(e) => pipeline.setOption("awsRoleArn", e.target.value)}
//           className="rounded-md border px-3 py-2"
//         >
//           <option value="">-- select --</option>
//           {pipeline.roles?.map((r) => (
//             <option key={r.arn} value={r.arn}>{r.name}</option>
//           ))}
//         </select>
//       </label>

//       {/* ====== Actions ====== */}
//       <div className="flex gap-3">
//         <button onClick={regenerateNow} disabled={busy} className="rounded-md border px-4 py-2 bg-white">
//           {busy ? "Generating…" : "Generate Pipeline"}
//         </button>
//         <button
//           onClick={() => navigate("/secrets")}
//           disabled={
//             !(
//               pipeline.result?.yaml ||
//               pipeline.result?.generated_yaml ||
//               pipeline.result?.data?.generated_yaml
//             )
//           }
//           className="rounded-md border px-4 py-2 bg-white"
//         >
//           Continue → Secrets
//         </button>
//       </div>

//       {/* ====== YAML Preview ====== */}
//       <div>
//         <div className="text-sm font-medium mb-1">YAML Preview</div>
//         <pre className="max-h-96 overflow-auto bg-[#131212ff] text-gray-100 rounded-lg p-3">
// {pipeline.result?.yaml ?? pipeline.result?.generated_yaml ?? "Click Generate Pipeline or use the chat to update & regenerate…"}
//         </pre>
//       </div>
//     </section>
//   );
// }
