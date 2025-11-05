// server/routes/auth.aws.js
import { Router } from "express";
import jwt from "jsonwebtoken";
import { query } from "../db.js";
import { fromSSO } from "@aws-sdk/credential-provider-sso";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { requireSession } from "../lib/requireSession.js";
import {
  SSOOIDCClient,
  RegisterClientCommand,
  StartDeviceAuthorizationCommand,
  CreateTokenCommand,
} from "@aws-sdk/client-sso-oidc";

const router = Router();
const SESSION_SECRET = process.env.SESSION_SECRET;

// ✅ Start AWS connect flow
router.post("/connect", requireSession, async (req, res) => {
  const { sso_start_url, sso_region, account_id, role_to_assume } = req.body;
  const userId = req.user.id;

  // Validate required parameters
  if (!sso_start_url || typeof sso_start_url !== 'string' || sso_start_url.trim() === '') {
    return res.status(400).json({ error: "Invalid or missing SSO start URL" });
  }
  if (!sso_region || typeof sso_region !== 'string' || sso_region.trim() === '') {
    return res.status(400).json({ error: "Invalid or missing SSO region" });
  }

  console.debug(`[AWS CONNECT] Starting SSO credential retrieval for user ${userId} with start URL: ${sso_start_url} and region: ${sso_region}`);

  try {
    // Step 1: Initiate SSO credential provider dynamically
    const creds = await fromSSO({
      ssoStartUrl: sso_start_url,
      region: sso_region,
    })();

    if (!creds || !creds.accessKeyId || !creds.secretAccessKey) {
      console.error("[AWS CONNECT ERROR] Retrieved credentials are incomplete or invalid", creds);
      return res.status(500).json({ error: "Failed to retrieve valid AWS credentials from SSO" });
    }

    console.debug("[AWS CONNECT] Retrieved SSO credentials successfully");

    // Step 2: Test the connection
    const s3 = new S3Client({
      region: sso_region,
      credentials: creds,
    });

    let Buckets;
    try {
      const response = await s3.send(new ListBucketsCommand({}));
      Buckets = response.Buckets || [];
      console.debug(`[AWS CONNECT] Successfully listed ${Buckets.length} buckets`);
    } catch (listErr) {
      console.error("[AWS CONNECT ERROR] Failed to list S3 buckets", listErr);
      return res.status(500).json({ error: "AWS credentials are invalid or lack permissions to list S3 buckets" });
    }

    // Step 3: Store in DB
    const result = await query(
      `
      insert into aws_connections (user_id, sso_start_url, sso_region, account_id, role_to_assume, access_key, secret_key, session_token, expires_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (user_id) do update
        set sso_start_url=$2,
            sso_region=$3,
            account_id=$4,
            role_to_assume=$5,
            access_key=$6,
            secret_key=$7,
            session_token=$8,
            expires_at=$9,
            updated_at=now()
      returning *;
      `,
      [
        userId,
        sso_start_url,
        sso_region,
        account_id || null,
        role_to_assume || null,
        creds.accessKeyId,
        creds.secretAccessKey,
        creds.sessionToken,
        creds.expiration,
      ]
    );

    const connection = result.rows[0];

    return res.json({
      message: "AWS connected successfully",
      buckets: Buckets.map(b => b.Name),
      connection,
      credentials_expiration: creds.expiration || null,
    });
  } catch (err) {
    console.error("[AWS CONNECT ERROR] Unexpected error during AWS connect flow", err);
    return res.status(500).json({ error: "An unexpected error occurred while connecting to AWS: " + err.message });
  }
});

// ✅ New GET /start endpoint to redirect users to their AWS SSO start URL with optional state parameters
router.get("/start", requireSession, async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await query(
      `select sso_start_url from aws_connections where user_id = $1 limit 1;`,
      [userId]
    );
    if (!rows.length) {
      console.warn(`[AWS START] No AWS SSO start URL found for user ${userId}`);
      return res.status(404).json({ error: "No AWS SSO start URL found for user" });
    }
    const ssoStartUrl = rows[0].sso_start_url;
    if (!ssoStartUrl || typeof ssoStartUrl !== 'string' || ssoStartUrl.trim() === '') {
      console.warn(`[AWS START] Invalid SSO start URL for user ${userId}`);
      return res.status(400).json({ error: "Invalid AWS SSO start URL for user" });
    }

    // Optional state parameters can be passed as query params and appended to redirect URL
    const stateParams = req.query.state ? `?state=${encodeURIComponent(req.query.state)}` : '';
    const redirectUrl = ssoStartUrl + stateParams;

    console.debug(`[AWS START] Redirecting user ${userId} to AWS SSO start URL: ${redirectUrl}`);
    return res.redirect(redirectUrl);
  } catch (err) {
    console.error(`[AWS START ERROR] Failed to redirect user ${userId} to AWS SSO start URL`, err);
    return res.status(500).json({ error: "Failed to redirect to AWS SSO start URL: " + err.message });
  }
});

// ✅ New GET /callback endpoint to handle AWS redirect after login and store credentials
router.get("/callback", requireSession, async (req, res) => {
  const userId = req.user.id;
  try {
    // Retrieve existing connection info for user to get sso_start_url and sso_region
    const { rows } = await query(
      `select sso_start_url, sso_region, account_id, role_to_assume from aws_connections where user_id = $1 limit 1;`,
      [userId]
    );
    if (!rows.length) {
      console.warn(`[AWS CALLBACK] No AWS connection info found for user ${userId}`);
      return res.status(404).json({ error: "No AWS connection info found for user" });
    }
    const { sso_start_url, sso_region, account_id, role_to_assume } = rows[0];
    if (!sso_start_url || !sso_region) {
      console.warn(`[AWS CALLBACK] Missing SSO start URL or region for user ${userId}`);
      return res.status(400).json({ error: "Missing AWS SSO start URL or region for user" });
    }

    console.debug(`[AWS CALLBACK] Attempting to retrieve SSO credentials for user ${userId}`);

    // Retrieve credentials via fromSSO
    const creds = await fromSSO({
      ssoStartUrl: sso_start_url,
      region: sso_region,
    })();

    if (!creds || !creds.accessKeyId || !creds.secretAccessKey) {
      console.error(`[AWS CALLBACK ERROR] Retrieved credentials are incomplete or invalid for user ${userId}`, creds);
      return res.status(500).json({ error: "Failed to retrieve valid AWS credentials from SSO" });
    }

    console.debug(`[AWS CALLBACK] Retrieved SSO credentials successfully for user ${userId}`);

    // Test S3 access
    const s3 = new S3Client({
      region: sso_region,
      credentials: creds,
    });

    let Buckets;
    try {
      const response = await s3.send(new ListBucketsCommand({}));
      Buckets = response.Buckets || [];
      console.debug(`[AWS CALLBACK] Successfully listed ${Buckets.length} buckets for user ${userId}`);
    } catch (listErr) {
      console.error(`[AWS CALLBACK ERROR] Failed to list S3 buckets for user ${userId}`, listErr);
      return res.status(500).json({ error: "AWS credentials are invalid or lack permissions to list S3 buckets" });
    }

    // Store credentials in DB
    const result = await query(
      `
      insert into aws_connections (user_id, sso_start_url, sso_region, account_id, role_to_assume, access_key, secret_key, session_token, expires_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (user_id) do update
        set sso_start_url=$2,
            sso_region=$3,
            account_id=$4,
            role_to_assume=$5,
            access_key=$6,
            secret_key=$7,
            session_token=$8,
            expires_at=$9,
            updated_at=now()
      returning *;
      `,
      [
        userId,
        sso_start_url,
        sso_region,
        account_id || null,
        role_to_assume || null,
        creds.accessKeyId,
        creds.secretAccessKey,
        creds.sessionToken,
        creds.expiration,
      ]
    );

    const connection = result.rows[0];

    console.debug(`[AWS CALLBACK] Stored AWS connection info for user ${userId}`);

    return res.json({
      message: "AWS connected successfully via callback",
      buckets: Buckets.map(b => b.Name),
      connection,
      credentials_expiration: creds.expiration || null,
    });
  } catch (err) {
    console.error(`[AWS CALLBACK ERROR] Unexpected error during AWS callback flow for user ${userId}`, err);
    return res.status(500).json({ error: "An unexpected error occurred while processing AWS callback: " + err.message });
  }
});

// ✅ Verify connection
router.get("/me", requireSession, async (req, res) => {
  const { rows } = await query(
    `select * from aws_connections where user_id = $1 limit 1;`,
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: "No AWS connection found" });
  res.json(rows[0]);
});

export default router;
// AWS OIDC Device Authorization Flow
router.get("/start-device", requireSession, async (req, res) => {
  const userId = req.user.id;
  // You may want to get region from query param or config
  const region = process.env.AWS_REGION || "us-west-2";
  try {
    const oidc = new SSOOIDCClient({ region });
    // Register client
    const registerResp = await oidc.send(
      new RegisterClientCommand({
        clientName: "AutoDeployDeviceClient",
        clientType: "public",
      })
    );
    const { clientId, clientSecret, clientSecretExpiresAt } = registerResp;
    // Start device authorization
    const deviceAuthResp = await oidc.send(
      new StartDeviceAuthorizationCommand({
        clientId,
        clientSecret,
        startUrl: req.query.sso_start_url || process.env.AWS_SSO_START_URL,
      })
    );
    const {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete,
      expiresIn,
      interval,
    } = deviceAuthResp;
    // Store session in DB
    await query(
      `insert into aws_device_sessions (user_id, client_id, client_secret, device_code, user_code, verification_uri, verification_uri_complete, expires_at, poll_interval)
       values ($1,$2,$3,$4,$5,$6,$7,now() + ($8 || ' seconds')::interval, $9)
       on conflict (user_id) do update
         set client_id=$2,
             client_secret=$3,
             device_code=$4,
             user_code=$5,
             verification_uri=$6,
             verification_uri_complete=$7,
             expires_at=now() + ($8 || ' seconds')::interval,
             poll_interval=$9,
             updated_at=now()
      `,
      [
        userId,
        clientId,
        clientSecret,
        deviceCode,
        userCode,
        verificationUri,
        verificationUriComplete,
        expiresIn,
        interval,
      ]
    );
    // Redirect user to verificationUriComplete
    return res.redirect(verificationUriComplete);
  } catch (err) {
    console.error("[AWS DEVICE FLOW ERROR] Failed to start device authorization", err);
    return res.status(500).json({ error: "Failed to start device authorization: " + err.message });
  }
});

router.get("/device-callback", requireSession, async (req, res) => {
  const userId = req.user.id;
  const region = process.env.AWS_REGION || "us-west-2";
  try {
    // Get device session
    const { rows } = await query(
      `select * from aws_device_sessions where user_id = $1 and expires_at > now() order by expires_at desc limit 1;`,
      [userId]
    );
    if (!rows.length) {
      return res.status(404).send("No pending device authorization session found.");
    }
    const session = rows[0];
    const {
      client_id,
      client_secret,
      device_code,
      poll_interval,
    } = session;
    const oidc = new SSOOIDCClient({ region });
    let tokenResp = null;
    let attempts = 0;
    const maxAttempts = 60;
    while (attempts < maxAttempts) {
      try {
        tokenResp = await oidc.send(
          new CreateTokenCommand({
            clientId: client_id,
            clientSecret: client_secret,
            deviceCode: device_code,
            grantType: "urn:ietf:params:oauth:grant-type:device_code",
          })
        );
        break;
      } catch (err) {
        if (
          err.name === "AuthorizationPendingException" ||
          err.name === "SlowDownException"
        ) {
          // Wait for poll_interval seconds
          await new Promise((resolve) => setTimeout(resolve, (poll_interval || 5) * 1000));
          attempts++;
          continue;
        } else {
          console.error("[AWS DEVICE FLOW ERROR] Unexpected error while polling for token", err);
          return res.status(500).send("Failed to obtain AWS device token: " + err.message);
        }
      }
    }
    if (!tokenResp) {
      return res.status(408).send("Device authorization timed out. Please try again.");
    }
    // Store credentials in aws_connections
    const { accessToken, expiresIn, refreshToken, tokenType } = tokenResp;
    const result = await query(
      `
      insert into aws_connections (user_id, access_token, refresh_token, token_type, expires_at)
      values ($1,$2,$3,$4,now() + ($5 || ' seconds')::interval)
      on conflict (user_id) do update
        set access_token=$2,
            refresh_token=$3,
            token_type=$4,
            expires_at=now() + ($5 || ' seconds')::interval,
            updated_at=now()
      returning *;
      `,
      [
        userId,
        accessToken,
        refreshToken || null,
        tokenType,
        expiresIn,
      ]
    );
    // Success response
    res.setHeader("Content-Type", "text/html");
    return res.send(
      "<h2>✅ AWS Device Authorization successful!</h2><p>You may now return to the application.</p>"
    );
  } catch (err) {
    console.error("[AWS DEVICE FLOW ERROR] Failed during device callback", err);
    return res.status(500).send("Failed to complete device authorization: " + err.message);
  }
});