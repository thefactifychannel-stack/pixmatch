import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { AlertCircle, Camera, CheckCircle2, Info, Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — PhotoFlow" },
      { name: "description", content: "Photographer access to PhotoFlow." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [notice, setNotice] = useState<{
    type: "info" | "success" | "error";
    title: string;
    description: string;
  } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentEmail(data.user?.email ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentEmail(session?.user.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  function getAuthErrorMessage(err: unknown) {
    const error = err as { code?: string; message?: string };
    const message = error.message ?? "Authentication failed";
    const code = error.code;
    if (code === "weak_password" || /pwned|weak/i.test(message)) {
      return "That password has appeared in known data breaches. Please pick a stronger, unique password with upper/lowercase letters, numbers, and symbols.";
    }
    if (code === "user_already_exists" || /already registered|already exists/i.test(message)) {
      return "An account with this email already exists. Switch to sign in and use the password for that account.";
    }
    if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
      return "Invalid email or password. Check the account email and password, then try again.";
    }
    if (/email not confirmed/i.test(message)) {
      return "Please confirm your email address first, then sign in.";
    }
    return message;
  }

  async function clearBrowserSession() {
    setStatusText("Clearing any previous session…");
    await queryClient.cancelQueries();
    queryClient.clear();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error && !/session|not found/i.test(error.message)) {
      console.warn("Local session clear warning:", error.message);
    }
    router.invalidate();
  }

  async function finishSignedInRedirect(expectedEmail: string) {
    setStatusText("Verifying the signed-in account…");
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw error ?? new Error("Could not verify the signed-in account.");

    const verifiedEmail = data.user.email ?? "";
    if (verifiedEmail.toLowerCase() !== expectedEmail.toLowerCase()) {
      throw new Error(`Signed in as ${verifiedEmail || "another account"}, not ${expectedEmail}. Please try again.`);
    }

    setCurrentEmail(verifiedEmail);
    setNotice({
      type: "success",
      title: "Authentication successful",
      description: `Signed in as ${verifiedEmail}. Loading your dashboard now.`,
    });
    await queryClient.cancelQueries();
    queryClient.clear();
    router.invalidate();
    toast.success(`Signed in as ${verifiedEmail}`, { id: "auth-flow" });
    navigate({ to: "/dashboard", replace: true });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setNotice(null);
    const normalizedEmail = email.trim().toLowerCase();
    const actionLabel = mode === "signup" ? "Creating account" : "Signing in";
    setStatusText(`${actionLabel}…`);
    toast.loading(`${actionLabel}…`, { id: "auth-flow" });
    try {
      await clearBrowserSession();
      if (mode === "signup") {
        setStatusText("Submitting signup request…");
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) {
          const message = getAuthErrorMessage(error);
          setNotice({ type: "error", title: "Signup failed", description: message });
          toast.error(message, { id: "auth-flow" });
          if ((error as { code?: string }).code === "user_already_exists" || /already registered|already exists/i.test(error.message)) {
            setMode("login");
          }
          return;
        }
        if (data.session) {
          await finishSignedInRedirect(normalizedEmail);
        } else {
          setNotice({
            type: "success",
            title: "Account created",
            description: "Please check your email to confirm the account, then sign in with the same credentials.",
          });
          toast.success("Account created. Check your email to confirm it, then sign in.", { id: "auth-flow" });
          setMode("login");
        }
      } else {
        setStatusText("Checking credentials…");
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) {
          const message = getAuthErrorMessage(error);
          setNotice({ type: "error", title: "Login failed", description: message });
          toast.error(message, { id: "auth-flow" });
          return;
        }
        await finishSignedInRedirect(normalizedEmail);
      }
    } catch (err: unknown) {
      const message = getAuthErrorMessage(err);
      setNotice({ type: "error", title: `${mode === "signup" ? "Signup" : "Login"} failed`, description: message });
      toast.error(message, { id: "auth-flow" });
    } finally {
      setLoading(false);
      setStatusText("");
    }
  }

  const noticeIcon = notice?.type === "success" ? CheckCircle2 : notice?.type === "error" ? AlertCircle : Info;
  const NoticeIcon = noticeIcon;

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--gradient-hero)" }}>
      <div className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-[var(--shadow-elegant)] border border-border">
        <Link to="/" className="flex items-center gap-2 font-semibold mb-6 justify-center">
          <Camera className="h-5 w-5 text-primary" />
          <span>PhotoFlow</span>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-center mb-1">
          {mode === "login" ? "Welcome back" : "Create account"}
        </h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          {mode === "login" ? "Sign in to manage events" : "Photographer account"}
        </p>
        {currentEmail && (
          <Alert className="mb-4">
            <Info className="h-4 w-4" />
            <AlertTitle>Current session</AlertTitle>
            <AlertDescription className="break-all">Signed in as {currentEmail}. Submitting this form will switch accounts.</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert variant={notice.type === "error" ? "destructive" : "default"} className="mb-4">
            <NoticeIcon className="h-4 w-4" />
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription>{notice.description}</AlertDescription>
          </Alert>
        )}
        <form onSubmit={submit} className="space-y-4" aria-busy={loading}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required disabled={loading} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={8} disabled={loading} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {loading && (
            <div className="flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{statusText || "Processing…"}</span>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? (mode === "login" ? "Signing in…" : "Creating account…") : mode === "login" ? "Sign in" : "Sign up"}
          </Button>
        </form>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setNotice(null);
            setMode(mode === "login" ? "signup" : "login");
          }}
          className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground transition"
        >
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}