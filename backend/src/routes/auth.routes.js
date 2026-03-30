'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const { pool } = require('../config/database');
const env = require('../config/env');
const { authenticate } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../utils/audit');

const router = express.Router();

const BCRYPT_COST = 12;

// ─── helpers ────────────────────────────────────────────────────────────────

function generateAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      scopeType: user.scope_type || null,
      scopeId: user.scope_id || null,
      displayName: user.display_name || '',
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );
}

function generateRefreshToken(userId) {
  const jti = uuidv4();
  const token = jwt.sign(
    { sub: userId, jti, type: 'refresh' },
    env.jwt.secret,
    { expiresIn: env.jwt.refreshExpiresIn }
  );
  return { token, jti };
}

/**
 * Decode a refresh token without throwing — returns payload or null.
 */
function decodeRefreshToken(token) {
  try {
    return jwt.verify(token, env.jwt.secret);
  } catch {
    return null;
  }
}

/**
 * Calculate expiry Date from a JWT payload exp (Unix seconds).
 */
function expToDate(exp) {
  return new Date(exp * 1000);
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return sendError(res, 'username and password are required', [], 400);
    }

    const [rows] = await pool.query(
      `SELECT id, username, password_hash, role, scope_type, scope_id,
              display_name, is_active, is_deleted
       FROM users
       WHERE username = ? AND is_deleted = FALSE
       LIMIT 1`,
      [String(username).trim()]
    );

    if (rows.length === 0) {
      return sendError(res, 'Invalid username or password', [], 401);
    }

    const user = rows[0];

    if (!user.is_active) {
      return sendError(res, 'Account is disabled', [], 401);
    }

    const passwordMatch = await bcrypt.compare(String(password), user.password_hash);
    if (!passwordMatch) {
      return sendError(res, 'Invalid username or password', [], 401);
    }

    // Update last_login
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    const accessToken = generateAccessToken(user);
    const { token: refreshToken } = generateRefreshToken(user.id);

    await logAudit({
      userId: user.id,
      action: 'LOGIN',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(
      res,
      {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: env.jwt.expiresIn,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          scope_type: user.scope_type,
          scope_id: user.scope_id,
          display_name: user.display_name,
        },
      },
      'Login successful',
      null,
      200
    );
  } catch (err) {
    return next(err);
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, username, role, scope_type, scope_id, display_name, last_login, created_at
       FROM users
       WHERE id = ? AND is_deleted = FALSE AND is_active = TRUE
       LIMIT 1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return sendError(res, 'User not found or account disabled', [], 401);
    }

    return sendSuccess(res, rows[0]);
  } catch (err) {
    return next(err);
  }
});

// ─── POST /api/auth/change-password ─────────────────────────────────────────

router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return sendError(res, 'current_password and new_password are required', [], 400);
    }

    if (String(new_password).length < 6) {
      return sendError(res, 'new_password must be at least 6 characters', [], 400);
    }

    const [rows] = await pool.query(
      'SELECT id, password_hash FROM users WHERE id = ? AND is_deleted = FALSE LIMIT 1',
      [req.user.id]
    );

    if (rows.length === 0) {
      return sendError(res, 'User not found', [], 404);
    }

    const match = await bcrypt.compare(String(current_password), rows[0].password_hash);
    if (!match) {
      return sendError(res, 'Current password is incorrect', [], 400);
    }

    const newHash = await bcrypt.hash(String(new_password), BCRYPT_COST);

    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

    await logAudit({
      userId: req.user.id,
      action: 'UPDATE',
      entityType: 'user',
      entityId: req.user.id,
      newValue: { action: 'password_changed' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, null, 'Password changed successfully');
  } catch (err) {
    return next(err);
  }
});

// ─── POST /api/auth/refresh-token ────────────────────────────────────────────

router.post('/refresh-token', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return sendError(res, 'refresh_token is required', [], 400);
    }

    const payload = decodeRefreshToken(refresh_token);

    if (!payload || payload.type !== 'refresh') {
      return sendError(res, 'Invalid or expired refresh token', [], 401);
    }

    // Check revocation list
    const [revoked] = await pool.query(
      'SELECT jti FROM revoked_tokens WHERE jti = ? LIMIT 1',
      [payload.jti]
    );
    if (revoked.length > 0) {
      return sendError(res, 'Refresh token has been revoked', [], 401);
    }

    // Check user still active
    const [rows] = await pool.query(
      `SELECT id, role, scope_type, scope_id, display_name
       FROM users
       WHERE id = ? AND is_deleted = FALSE AND is_active = TRUE
       LIMIT 1`,
      [payload.sub]
    );
    if (rows.length === 0) {
      return sendError(res, 'User not found or account disabled', [], 401);
    }

    const accessToken = generateAccessToken(rows[0]);

    return sendSuccess(
      res,
      {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: env.jwt.expiresIn,
      },
      'Token refreshed'
    );
  } catch (err) {
    return next(err);
  }
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      // No refresh token provided — still a valid logout (access token not stored)
      return sendSuccess(res, null, 'Logged out');
    }

    const payload = decodeRefreshToken(refresh_token);

    if (payload && payload.type === 'refresh' && payload.jti) {
      const expiresAt = expToDate(payload.exp);

      // Upsert to avoid duplicate error if client calls logout twice
      await pool.query(
        `INSERT INTO revoked_tokens (jti, user_id, expires_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE revoked_at = revoked_at`,
        [payload.jti, req.user.id, expiresAt]
      );
    }

    return sendSuccess(res, null, 'Logged out successfully');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
