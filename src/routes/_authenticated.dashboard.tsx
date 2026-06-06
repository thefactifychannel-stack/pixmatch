import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Calendar, ArrowRight } from "lucide-react";

type EventRow = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
  created_at: string;
};

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — PhotoFlow" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      toast.error("Please sign in again to load your dashboard.");
      setEvents([]);
      setLoading(false);
      return;
    }
    setUserEmail(userData.user.email ?? null);
    const { data, error } = await supabase
      .from("events")
      .select("id,owner_id,name,slug,description,active,created_at")
      .eq("owner_id", userData.user.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setEvents(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="container mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your events</h1>
          <p className="text-muted-foreground mt-1">
            {userEmail
              ? `Signed in as ${userEmail}`
              : "Create an event, upload photos, share the QR."}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New event
            </Button>
          </DialogTrigger>
          <CreateEventDialog
            onCreated={() => {
              setOpen(false);
              load();
            }}
          />
        </Dialog>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-16 text-center">
          <Calendar className="mx-auto h-10 w-10 text-muted-foreground mb-4" />
          <h2 className="text-xl font-medium">No events yet</h2>
          <p className="text-muted-foreground mt-2">Create your first event to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <Link
              key={e.id}
              to="/events/$eventId"
              params={{ eventId: e.id }}
              className="group rounded-2xl border border-border bg-card p-6 transition hover:border-primary/50"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{e.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">/{e.slug}</p>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition" />
              </div>
              {e.description && (
                <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{e.description}</p>
              )}
              <div className="mt-4 inline-flex items-center gap-2 text-xs">
                <span
                  className={`h-2 w-2 rounded-full ${e.active ? "bg-primary" : "bg-muted-foreground"}`}
                />
                {e.active ? "Active" : "Inactive"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function CreateEventDialog({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      toast.error("Please sign in again before creating an event.");
      setLoading(false);
      return;
    }
    const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
    const { error } = await supabase.from("events").insert({
      name,
      description: description || null,
      slug,
      owner_id: u.user.id,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Event created");
    setName("");
    setDescription("");
    onCreated();
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New event</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Event name</Label>
          <Input
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sarah & James Wedding"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="desc">Description (optional)</Label>
          <Textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={loading || !name}>
            {loading ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}