import { z } from 'zod';

/**
 * A small, explicit error type for API endpoints.
 *
 * Throw this from route handlers (or tool handlers) when you want to control:
 * - HTTP status
 * - stable error code
 * - user-facing message
 * - optional details for debugging
 */
export class ApiError extends Error {
  constructor({ status = 500, code = 'INTERNAL', message = 'Internal error', details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getResponseMeta(req, extra = undefined) {
  const meta = {
    request_id: req?.requestId || req?.headers?.['x-request-id'] || null,
    timestamp: new Date().toISOString(),
  };

  if (extra && typeof extra === 'object') {
    return { ...meta, ...extra };
  }

  return meta;
}

export function sendOk(req, res, data, { status = 200, meta } = {}) {
  return res.status(status).json({
    ok: true,
    data,
    meta: getResponseMeta(req, meta),
  });
}

// --- Legacy/v1 wire helpers (do NOT use for new endpoints) ---
// These preserve the existing v1 envelope used by /mcp/v1/* routes.
export function sendSuccessV1(req, res, data, { status = 200 } = {}) {
  return res.status(status).json({
    success: true,
    data,
    request_id: req?.requestId || null,
  });
}

export function sendErrorV1(req, res, err, { status: statusOverride } = {}) {
  const normalized = normalizeError(err);
  const status = statusOverride ?? normalized.status;

  return res.status(status).json({
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
    },
    request_id: req?.requestId || null,
  });
}

export function normalizeError(err) {
  // Zod validation
  if (err instanceof z.ZodError || err?.name === 'ZodError') {
    return {
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Invalid input',
      details: err.issues || err.errors || err.message,
    };
  }

  // Explicit application errors
  if (err instanceof ApiError || err?.name === 'ApiError') {
    return {
      status: err.status || 500,
      code: err.code || 'INTERNAL',
      message: err.message || 'Internal error',
      details: err.details,
    };
  }

  // Generic/unexpected
  return {
    status: err?.status || 500,
    code: err?.code || 'INTERNAL',
    message: err?.message || 'Internal error',
    details: err?.details,
  };
}

export function sendError(req, res, err, { meta } = {}) {
  const normalized = normalizeError(err);

  return res.status(normalized.status).json({
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
    },
    meta: getResponseMeta(req, meta),
  });
}
