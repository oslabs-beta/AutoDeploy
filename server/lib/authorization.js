// Centralized authorization helpers: roles, plans, capabilities
// This builds on `requireSession`, which populates `req.user` from the JWT + `public.users`.

export const Actions = {
  USE_AGENT: 'USE_AGENT',
  USE_MCP_TOOL: 'USE_MCP_TOOL',
  MANAGE_USERS: 'MANAGE_USERS',
  MANAGE_BANNERS: 'MANAGE_BANNERS',
  // Future examples:
  // DEPLOY_PROJECT: 'DEPLOY_PROJECT',
};

const BETA_TREAT_ALL_AS_PRO = process.env.BETA_TREAT_ALL_AS_PRO === 'true';

export function isPro(user) {
  // During beta, a single env flag can allow all authenticated users to behave as "pro".
  if (BETA_TREAT_ALL_AS_PRO) return true;

  // Per-user beta flag: permanently treat these users as pro, even after
  // global beta ends. This is useful for grandfathering early adopters.
  if (user?.beta_pro_granted) return true;

  // `plan` comes from `public.users.plan` (enum: 'free' | 'pro').
  // Be defensive in case user is null/undefined.
  return user?.plan === 'pro';
}

export function can(user, action) {
  if (!user) return false;

  // System / god users: separate trust zone. For now they can do everything.
  if (user.role === 'SYSTEM_ADMIN') {
    return true;
  }

  switch (action) {
    case Actions.USE_AGENT:
      // Only pro users (or everyone during beta) can use the agent.
      return isPro(user);

    case Actions.USE_MCP_TOOL:
      // MCP core tools are part of the main product. For now, any authenticated
      // user can reach them. If you later want them pro-only, change this to
      // `return isPro(user);`.
      return true;

    case Actions.MANAGE_USERS:
      // Non-system admins are not allowed to manage users. Note that we already
      // returned true above for SYSTEM_ADMIN users.
      return false;

    default:
      return false;
  }
}

// Express middleware factory
export function requireCapability(action) {
  return function capabilityMiddleware(req, res, next) {
    const user = req.user;

    if (!user) {
      // If this fires, it usually means `requireSession` was not mounted before
      // `requireCapability` on the route.
      return res.status(401).json({ error: 'No active session' });
    }

    if (!can(user, action)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return next();
  };
}
