import express from "express";
import { requireSession } from "../lib/requireSession.js";
// import { generateYAML, editYAML } from "../agent/wizardAgent.js";

const router = express.Router();

/* ------------------------------------------------------
 * STEP 1 — Create Pipeline Session
 * ------------------------------------------------------ */
router.post("/", requireSession, async (req, res) => {
  try {
    const supabase = req.supabase;
    const user = req.user;
    if (!user) {
      console.warn(`[pipeline-sessions] No user on request for ${req.originalUrl}`);
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { github_username } = user;
    if (!github_username) {
      return res.status(400).json({
        error: "User does not have a GitHub username stored.",
      });
    }

    const { data, error } = await supabase
      .from("pipeline_sessions")
      .insert({
        user_id: user.id,
        github_username,
        status: "created",
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: "Failed to create pipeline session",
        details: error,
      });
    }

    await supabase.from("pipeline_events").insert({
      pipeline_session_id: data.id,
      user_id: user.id,
      event_type: "session_created",
      payload: {},
    });

    return res.json({ success: true, pipeline_session: data });
  } catch (err) {
    return res.status(500).json({
      error: "Unhandled error creating pipeline session",
      details: err.message,
    });
  }
});

/* ------------------------------------------------------
 * STEP 2 — Select Repo
 * ------------------------------------------------------ */
router.post("/:id/select-repo", requireSession, async (req, res) => {
  try {
    const supabase = req.supabase;
    const user = req.user;
    if (!user) {
      console.warn(`[pipeline-sessions] No user on request for ${req.originalUrl}`);
      return res.status(401).json({ error: "Not authenticated" });
    }
    const sessionId = req.params.id;
    const { repo_full_name } = req.body;

    console.log("[select-repo] Incoming repo_full_name:", repo_full_name);

    if (!repo_full_name) {
      return res.status(400).json({
        error: "repo_full_name is required",
      });
    }

    const { data: session, error: sessionError } = await supabase
      .from("pipeline_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({
        error: "Pipeline session not found or does not belong to user",
        details: sessionError,
      });
    }

    console.log("[select-repo] Query: user_id =", user.id, "full_name ilike =", repo_full_name);
    const { data: repo, error: repoError } = await supabase
      .from("github_repos")
      .select("*")
      .eq("user_id", user.id)
      .ilike("full_name", repo_full_name)
      .single();

    console.log("[select-repo] Repo query result:", { repo, repoError });

    if (repoError || !repo) {
      console.warn("[select-repo] Repo NOT FOUND for:", repo_full_name);
      return res.status(404).json({
        error: "Repository not found in github_repos",
        details: repoError,
      });
    }

    console.log("[select-repo] Updating pipeline session with repo:", repo.full_name);
    const { data: updated, error: updateError } = await supabase
      .from("pipeline_sessions")
      .update({
        repo_full_name: repo.full_name,
        repo_id: repo.id,
        repo_language: repo.language,
        repo_visibility: repo.visibility,
        repo_default_branch: repo.default_branch,
        status: "repo_selected",
      })
      .eq("id", sessionId)
      .select()
      .single();

    if (updateError) {
      console.error("[select-repo] UPDATE ERROR:", updateError);
      return res.status(500).json({
        error: "Failed to update pipeline session with repo data",
        details: updateError,
      });
    }

    await supabase.from("pipeline_events").insert({
      pipeline_session_id: sessionId,
      user_id: user.id,
      event_type: "repo_selected",
      payload: { repo_full_name },
    });

    return res.json({
      success: true,
      pipeline_session: updated,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Unhandled error selecting repo",
      details: err.message,
    });
  }
});

/* ------------------------------------------------------
 * STEP 3 — Select Template + Provider
 * ------------------------------------------------------ */
router.post("/:id/select-template", requireSession, async (req, res) => {
  try {
    const supabase = req.supabase;
    const user = req.user;
    if (!user) {
      console.warn(`[pipeline-sessions] No user on request for ${req.originalUrl}`);
      return res.status(401).json({ error: "Not authenticated" });
    }
    const sessionId = req.params.id;

    const { provider, template } = req.body;
    if (!provider || !template) {
      return res.status(400).json({
        error: "provider and template are required",
      });
    }

    const { data: session, error: sessionError } = await supabase
      .from("pipeline_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({
        error: "Pipeline session not found or does not belong to user",
        details: sessionError,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("pipeline_sessions")
      .update({
        provider,
        template,
        status: "template_configured",
      })
      .eq("id", sessionId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        error: "Failed to update pipeline session",
        details: updateError,
      });
    }

    await supabase.from("pipeline_events").insert({
      pipeline_session_id: sessionId,
      user_id: user.id,
      event_type: "template_configured",
      payload: { provider, template },
    });

    return res.json({
      success: true,
      pipeline_session: updated,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Unhandled error selecting template/provider",
      details: err.message,
    });
  }
});

/* ------------------------------------------------------
 * STEP 4 — Generate YAML (calls wizardAgent.generateYAML)
 * ------------------------------------------------------ */
router.post("/:id/generate-yaml", requireSession, async (req, res) => {
  try {
    const supabase = req.supabase;
    const user = req.user;
    if (!user) {
      console.warn(`[pipeline-sessions] No user on request for ${req.originalUrl}`);
      return res.status(401).json({ error: "Not authenticated" });
    }
    const sessionId = req.params.id;

    const { data: session } = await supabase
      .from("pipeline_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .single();

    if (!session) {
      return res.status(404).json({ error: "Pipeline session not found" });
    }

    const yamlResult = await generateYAML({
      repo_full_name: session.repo_full_name,
      template: session.template,
      provider: session.provider,
      language: session.repo_language,
      default_branch: session.repo_default_branch,
      workflow_path: session.workflow_path,
      cookie: req.headers.cookie,
    });
    console.log("[generate-yaml] Raw yamlResult:", yamlResult);
    console.log("[generate-yaml] yamlResult.success:", yamlResult?.success);
    console.log("[generate-yaml] yamlResult.yaml:", yamlResult?.yaml);
    console.log("[generate-yaml] yamlResult.error:", yamlResult?.error);

    if (!yamlResult || yamlResult.success === false || !yamlResult.yaml) {
      console.error("[generate-yaml] YAML generation failed — yamlResult:", yamlResult);
      return res.status(500).json({
        error: "YAML generation failed",
        details: yamlResult?.error || "No YAML returned",
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("pipeline_sessions")
      .update({
        draft_yaml: yamlResult.yaml,
        status: "yaml_generated",
      })
      .eq("id", sessionId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        error: "Failed to store generated YAML",
        details: updateError,
      });
    }

    await supabase.from("pipeline_events").insert({
      pipeline_session_id: sessionId,
      user_id: user.id,
      event_type: "yaml_generated",
      payload: {},
    });

    return res.json({
      success: true,
      yaml: yamlResult.yaml,
      pipeline_session: updated,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Unhandled error generating YAML",
      details: err.message,
    });
  }
});

/* ------------------------------------------------------
 * STEP 5 — Edit YAML (LLM-assisted)
 * ------------------------------------------------------ */
router.post("/:id/edit-yaml", requireSession, async (req, res) => {
  try {
    const supabase = req.supabase;
    const user = req.user;
    if (!user) {
      console.warn(`[pipeline-sessions] No user on request for ${req.originalUrl}`);
      return res.status(401).json({ error: "Not authenticated" });
    }
    const sessionId = req.params.id;

    const { user_request, draft_yaml } = req.body;

    const { data: session } = await supabase
      .from("pipeline_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .single();

    if (!session) {
      return res.status(404).json({ error: "Pipeline session not found" });
    }

    let newYaml;

    if (user_request) {
      const editResult = await editYAML({
        current_yaml: session.draft_yaml,
        user_request,
        cookie: req.headers.cookie,
      });

      if (!editResult.success) {
        return res.status(500).json({
          error: "YAML edit failed",
          details: editResult.error,
        });
      }

      newYaml = editResult.yaml;
    } else if (draft_yaml) {
      newYaml = draft_yaml;
    } else {
      return res.status(400).json({
        error: "Either user_request or draft_yaml must be provided",
      });
    }

    const { data: updated } = await supabase
      .from("pipeline_sessions")
      .update({
        draft_yaml: newYaml,
        status: "yaml_edited",
      })
      .eq("id", sessionId)
      .select()
      .single();

    await supabase.from("pipeline_events").insert({
      pipeline_session_id: sessionId,
      user_id: user.id,
      event_type: "yaml_edited",
      payload: { method: user_request ? "llm" : "manual" },
    });

    return res.json({
      success: true,
      yaml: newYaml,
      pipeline_session: updated,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Unhandled error editing YAML",
      details: err.message,
    });
  }
});

/* ------------------------------------------------------
 * STEP 6 — Commit YAML (calls pipeline_commit)
 * ------------------------------------------------------ */
router.post("/:id/commit", requireSession, async (req, res) => {
  try {
    const supabase = req.supabase;
    const user = req.user;
    if (!user) {
      console.warn(`[pipeline-sessions] No user on request for ${req.originalUrl}`);
      return res.status(401).json({ error: "Not authenticated" });
    }
    const sessionId = req.params.id;

    const { data: session } = await supabase
      .from("pipeline_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .single();

    if (!session) {
      return res.status(404).json({ error: "Pipeline session not found" });
    }

    const payload = {
      repoFullName: session.repo_full_name,
      branch: session.branch || session.repo_default_branch,
      path: session.workflow_path,
      yaml: session.draft_yaml,
    };

    const commitRes = await fetch(
      "http://localhost:3000/mcp/v1/pipeline_commit",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: req.headers.cookie || "",
        },
        body: JSON.stringify(payload),
      }
    ).then((r) => r.json());

    // Normalize MCP commit response
    const mcpCommit = commitRes?.data?.commit || null;
    const commit_sha =
      commitRes?.data?.commit_sha ||
      mcpCommit?.sha ||
      null;

    const commit_url =
      commitRes?.data?.commit_url ||
      mcpCommit?.html_url ||
      null;

    if (!commit_sha) {
      return res.status(500).json({
        error: "pipeline_commit failed",
        details: commitRes,
      });
    }

    const { data: version } = await supabase
      .from("pipeline_versions")
      .insert({
        user_id: user.id,
        repo_full_name: session.repo_full_name,
        branch: payload.branch,
        workflow_path: session.workflow_path,
        yaml: session.draft_yaml,
        yaml_hash: String(session.draft_yaml.length),
        source: "pipeline_commit",
        pipeline_session_id: sessionId,
      })
      .select()
      .single();

    const { data: updated } = await supabase
      .from("pipeline_sessions")
      .update({
        final_yaml: session.draft_yaml,
        pipeline_version_id: version.id,
        commit_sha,
        commit_url,
        status: "committed",
      })
      .eq("id", sessionId)
      .select()
      .single();

    await supabase.from("pipeline_events").insert({
      pipeline_session_id: sessionId,
      user_id: user.id,
      event_type: "commit_succeeded",
      payload: { commit_sha },
    });

    return res.json({
      success: true,
      commit_sha,
      commit_url,
      pipeline_session: updated,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Unhandled error committing YAML",
      details: err.message,
    });
  }
});

export default router;