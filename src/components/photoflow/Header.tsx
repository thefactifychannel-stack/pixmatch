import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";

export function Header() {
  const [email, setEmail] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) {
        setEmail(null);
        return;
      }
      setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-50">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Camera className="h-5 w-5 text-primary" />
          <span>PhotoFlow</span>
        </Link>
        <nav className="flex items-center gap-2">
          {email ? (
            <>
              <Link to="/dashboard">
                <Button variant="ghost" size="sm">Dashboard</Button>
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await queryClient.cancelQueries();
                  queryClient.clear();
                  await supabase.auth.signOut();
                  navigate({ to: "/auth", replace: true });
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Link to="/auth">
              <Button size="sm">Photographer login</Button>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}