import { createClient } from '@supabase/supabase-js';

let _supabase = null;

function getSupabase() {
  if (_supabase) return _supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    // No-op mode: allow server to run without Supabase configured.
    return null;
  }

  _supabase = createClient(url, key);
  return _supabase;
}

// Best-effort insert into query_history; fallback to logs table
export async function logInteraction({ namespace, jobId, question, answer, prompt }) {
  const session = namespace || jobId;

  // 1) Try query_history (current implementation)
  try {
    const supabase = getSupabase();
    if (!supabase) return;

    const { error } = await supabase.from('query_history').insert([
      {
        job_id: session,
        question,
        answer,
      },
    ]);
    if (!error) return;
  } catch {
    // fall through
  }

  // 2) Fallback to logs table (if you created it)
  try {
    const supabase = getSupabase();
    if (!supabase) return;

    const { error } = await supabase.from('logs').insert([
      {
        question,
        prompt: prompt || null,
        answer,
        session_id: session || null,
      },
    ]);
    if (error) console.error('Error logging interaction (logs):', error.message);
  } catch (e) {
    // swallow
  }
}

export async function getHistoryByNamespace({ namespace, limit = 50 }) {
  const ns = String(namespace || '').trim();
  if (!ns) return [];

  // Prefer query_history, fallback to logs
  try {
    const supabase = getSupabase();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('query_history')
      .select('*')
      .eq('job_id', ns)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!error) return data || [];
  } catch {
    // fall through
  }

  try {
    const supabase = getSupabase();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .eq('session_id', ns)
      .order('id', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}
