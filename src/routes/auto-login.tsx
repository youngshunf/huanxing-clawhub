import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";

export const Route = createFileRoute("/auto-login")({
  component: AutoLogin,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      token: (search.token as string) || "",
    };
  },
});

function AutoLogin() {
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const validateToken = useQuery(api.huanxing.validateLoginToken, { token });
  const markTokenUsed = useMutation(api.huanxing.markTokenUsed);
  const { signIn } = useAuthActions();

  useEffect(() => {
    const performAutoLogin = async () => {
      if (!token) {
        setError("No token provided");
        setIsLoading(false);
        return;
      }

      if (validateToken === undefined) {
        return;
      }

      if (!validateToken.valid) {
        setError(validateToken.reason || "Invalid token");
        setIsLoading(false);
        return;
      }

      try {
        // Mark token as used
        await markTokenUsed({ token });

        // Sign in the user using Convex auth
        // Note: This assumes the auth system can accept userId directly
        // You may need to adjust this based on your auth implementation
        await signIn("anonymous", {
          userId: validateToken.userId,
        });

        // Redirect to home page
        navigate({ to: "/" });
      } catch (err) {
        console.error("Auto-login failed:", err);
        setError("Login failed. Please try again.");
        setIsLoading(false);
      }
    };

    performAutoLogin();
  }, [token, validateToken, markTokenUsed, signIn, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
          <p className="text-lg">Logging you in...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-6xl">⚠️</div>
          <h1 className="mb-2 text-2xl font-bold">Login Failed</h1>
          <p className="mb-4 text-gray-600">{error}</p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return null;
}
