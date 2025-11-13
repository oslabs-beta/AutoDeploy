

import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

export const google_adapter = {
  name: 'google_adapter',
  description: 'Handles Google Cloud Platform OAuth authentication and project setup.',

  // Step 1: Redirect to Google OAuth consent page
  async connect(req, res) {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
          'openid',
          'email',
          'profile',
          'https://www.googleapis.com/auth/cloud-platform'
        ],
      });

      res.redirect(authUrl);
    } catch (error) {
      console.error('Error generating Google OAuth URL:', error);
      res.status(500).json({ error: 'Failed to initialize Google OAuth flow.' });
    }
  },

  // Step 2: Handle the OAuth callback and store the token
  async callback(req, res) {
    try {
      const { code } = req.query;

      if (!code) {
        return res.status(400).json({ error: 'Missing authorization code.' });
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Encrypt tokens before storing in DB
      const encryptedToken = jwt.sign(tokens, process.env.JWT_SECRET);

      await pool.query(
        'INSERT INTO connections (provider, token) VALUES ($1, $2)',
        ['gcp', encryptedToken]
      );

      res.send('✅ Google Cloud account connected successfully!');
    } catch (error) {
      console.error('Error handling Google OAuth callback:', error);
      res.status(500).json({ error: 'Failed to complete Google OAuth flow.' });
    }
  },

  // Optional utility to retrieve decrypted token
  async getToken(userId) {
    try {
      const result = await pool.query(
        'SELECT token FROM connections WHERE provider = $1 AND user_id = $2',
        ['gcp', userId]
      );

      if (result.rows.length === 0) return null;

      const decrypted = jwt.verify(result.rows[0].token, process.env.JWT_SECRET);
      return decrypted;
    } catch (error) {
      console.error('Error retrieving Google token:', error);
      return null;
    }
  },
};