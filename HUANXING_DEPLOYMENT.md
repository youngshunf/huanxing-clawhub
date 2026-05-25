# ClawHub Huanxing Integration - Vercel Deployment Guide

## Overview
This guide explains how to deploy the Huanxing-integrated ClawHub to Vercel at hub.huanxing.ai

## Prerequisites
- GitHub repository: https://github.com/youngshunf/huanxing-clawhub
- Vercel account with access to deploy
- Convex account and project set up
- Custom domain: hub.huanxing.ai

## Step 1: Create Convex Project

1. Go to https://dashboard.convex.dev/
2. Create a new project or use existing one
3. Note down the following:
   - `CONVEX_URL` (e.g., https://xxx.convex.cloud)
   - `CONVEX_SITE_URL` (e.g., https://xxx.convex.site)
4. Deploy Convex functions:
   ```bash
   cd /Users/mac/openclaw-workspace/huanxing-clawhub
   bun install
   bunx convex deploy
   ```

## Step 2: Set up GitHub OAuth App (Optional)

If you want GitHub authentication:
1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Create new OAuth App
3. Set Authorization callback URL to: `https://hub.huanxing.ai/api/auth/callback/github`
4. Note down:
   - `AUTH_GITHUB_ID`
   - `AUTH_GITHUB_SECRET`

## Step 3: Generate Convex Auth Keys

```bash
bunx @convex-dev/auth
```

This will generate:
- `JWT_PRIVATE_KEY`
- `JWKS`

## Step 4: Deploy to Vercel

### 4.1 Import Project
1. Go to https://vercel.com/new
2. Import Git Repository: `youngshunf/huanxing-clawhub`
3. Select branch: `huanxing-main`
4. Framework Preset: Vite
5. Root Directory: `./`

### 4.2 Configure Environment Variables

Add the following environment variables in Vercel project settings:

**Required:**
- `VITE_CONVEX_URL` = Your Convex URL (e.g., https://xxx.convex.cloud)
- `VITE_CONVEX_SITE_URL` = Your Convex site URL (e.g., https://xxx.convex.site)
- `SITE_URL` = https://hub.huanxing.ai
- `CONVEX_SITE_URL` = Your Convex site URL

**Optional (for GitHub auth):**
- `AUTH_GITHUB_ID` = Your GitHub OAuth App ID
- `AUTH_GITHUB_SECRET` = Your GitHub OAuth App Secret
- `JWT_PRIVATE_KEY` = Generated JWT private key
- `JWKS` = Generated JWKS

**Optional (for embeddings):**
- `OPENAI_API_KEY` = Your OpenAI API key (if using embeddings)

### 4.3 Configure Custom Domain

1. In Vercel project settings, go to "Domains"
2. Add custom domain: `hub.huanxing.ai`
3. Follow Vercel's instructions to configure DNS:
   - Add CNAME record: `hub.huanxing.ai` → `cname.vercel-dns.com`
   - Or A record pointing to Vercel's IP

### 4.4 Deploy

1. Click "Deploy"
2. Wait for build to complete
3. Verify deployment at https://hub.huanxing.ai

## Step 5: Update Huanxing Backend Configuration

After deployment, update the integration_apps table in Huanxing backend:

```sql
INSERT INTO integration_apps (app_id, app_name, app_type, base_url, config, is_enabled)
VALUES (
  'clawhub',
  'ClawHub Skill Market',
  'clawhub',
  'https://hub.huanxing.ai',
  '{"base_url": "https://hub.huanxing.ai"}',
  true
);
```

## Step 6: Test Integration

1. In Huanxing frontend, navigate to skill market
2. Click "Connect to ClawHub"
3. Should auto-register and redirect to ClawHub
4. Verify iframe loads with auto-login

## API Endpoints

The following Huanxing integration endpoints are available:

### Convex Functions (Backend)
- `api.huanxing.autoRegister` - Auto-register user from Huanxing
- `api.huanxing.generateLoginToken` - Generate one-time login token
- `api.huanxing.validateLoginToken` - Validate login token
- `api.huanxing.markTokenUsed` - Mark token as used

### Frontend Routes
- `/auto-login?token=xxx` - Auto-login page for iframe integration

## Integration Flow

1. User clicks "Open Skill Market" in Huanxing
2. Huanxing backend calls ClawHub's autoRegister API
3. ClawHub creates/finds user and returns API key
4. Huanxing stores API key in integration_credentials table
5. When opening iframe, Huanxing calls generateLoginToken
6. Iframe loads: `https://hub.huanxing.ai/auto-login?token=xxx`
7. Auto-login page validates token and logs user in
8. User is redirected to ClawHub home page

## Troubleshooting

### Build Fails
- Check that all environment variables are set
- Verify Convex deployment is successful
- Check build logs for specific errors

### Auto-login Not Working
- Verify token is valid and not expired (5 minutes)
- Check browser console for errors
- Verify Convex functions are deployed
- Check that loginTokens table exists in Convex schema

### CORS Issues
- Verify vercel.json CSP headers allow iframe embedding
- Update X-Frame-Options if needed for iframe support
- Check that Convex CORS settings allow requests from Huanxing domain

## Security Notes

1. Login tokens expire after 5 minutes
2. Tokens are single-use only
3. All tokens are stored in Convex with expiry tracking
4. API keys should be stored securely in Huanxing backend
5. Consider rate limiting on auto-register endpoint

## Next Steps

1. Monitor deployment and error logs
2. Set up analytics and monitoring
3. Configure CDN and caching if needed
4. Set up staging environment for testing
5. Document API for Huanxing backend team
