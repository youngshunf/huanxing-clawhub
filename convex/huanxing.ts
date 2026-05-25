import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { nanoid } from "nanoid";

/**
 * Auto-register a user from Huanxing platform
 * Called by Huanxing backend when a user connects to ClawHub
 */
export const autoRegister = mutation({
  args: {
    huanxingUserId: v.number(),
    email: v.optional(v.string()),
    nickname: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { huanxingUserId, email, nickname } = args;

    // Check if user already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    let userId;
    if (existingUser) {
      userId = existingUser._id;
    } else {
      // Create new user
      userId = await ctx.db.insert("users", {
        email,
        name: nickname,
        displayName: nickname,
        handle: `huanxing_${huanxingUserId}`,
        role: "user",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // Generate API key (stored in Huanxing backend, not here)
    const apiKey = `hx_${nanoid(32)}`;

    return {
      success: true,
      userId: userId.toString(),
      apiKey,
    };
  },
});

/**
 * Generate a one-time login token for auto-login
 * Token expires in 5 minutes
 */
export const generateLoginToken = mutation({
  args: {
    huanxingUserId: v.number(),
  },
  handler: async (ctx, args) => {
    const { huanxingUserId } = args;

    // Find user by handle
    const user = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", `huanxing_${huanxingUserId}`))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Generate token
    const token = nanoid(32);
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store token
    await ctx.db.insert("loginTokens", {
      token,
      userId: user._id,
      huanxingUserId,
      expiresAt,
      used: false,
      createdAt: Date.now(),
    });

    return {
      token,
      expiresAt,
    };
  },
});

/**
 * Validate and consume a login token
 * Returns user info if token is valid
 */
export const validateLoginToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;

    // Find token
    const loginToken = await ctx.db
      .query("loginTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (!loginToken) {
      return { valid: false, reason: "Token not found" };
    }

    // Check if already used
    if (loginToken.used) {
      return { valid: false, reason: "Token already used" };
    }

    // Check if expired
    if (loginToken.expiresAt < Date.now()) {
      return { valid: false, reason: "Token expired" };
    }

    // Get user info
    const user = await ctx.db.get(loginToken.userId);
    if (!user) {
      return { valid: false, reason: "User not found" };
    }

    return {
      valid: true,
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
      handle: user.handle,
    };
  },
});

/**
 * Mark a login token as used
 * Called after successful login
 */
export const markTokenUsed = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;

    const loginToken = await ctx.db
      .query("loginTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (!loginToken) {
      throw new Error("Token not found");
    }

    await ctx.db.patch(loginToken._id, {
      used: true,
      usedAt: Date.now(),
    });

    return { success: true };
  },
});
