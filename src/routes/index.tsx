import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/photoflow/Header";
import { Button } from "@/components/ui/button";
import { Camera, QrCode, Sparkles, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PhotoFlow — AI event photo delivery" },
      { name: "description", content: "Guests scan a QR, upload a selfie, and instantly see only photos of themselves." },
      { property: "og:title", content: "PhotoFlow" },
      { property: "og:description", content: "AI-powered event photography. From shutter to guest's phone." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <section className="container mx-auto px-4 pt-20 pb-24 text-center" style={{ background: "var(--gradient-hero)" }}>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground mb-6">
            <Sparkles className="h-3 w-3 text-primary" /> AI face matching · Private by design
          </div>
          <h1 className="text-5xl md:text-6xl font-semibold tracking-tight max-w-3xl mx-auto">
            From the shutter to your guests' phones.
          </h1>
          <p className="text-lg text-muted-foreground mt-6 max-w-xl mx-auto">
            PhotoFlow turns event photos into personal galleries. Guests scan a QR, upload a selfie, and see only the photos of themselves.
          </p>
          <div className="mt-10 flex flex-wrap gap-3 justify-center">
            <Link to="/auth"><Button size="lg">Start as photographer</Button></Link>
            <a href="#how"><Button size="lg" variant="outline">How it works</Button></a>
          </div>
        </section>

        <section id="how" className="container mx-auto px-4 py-20">
          <div className="grid md:grid-cols-3 gap-6">
            <Feature icon={<Camera className="h-5 w-5" />} title="Upload from anywhere" desc="Drop SnapBridge-transferred photos into the browser. Faces indexed instantly." />
            <Feature icon={<QrCode className="h-5 w-5" />} title="One QR per event" desc="Print, project, or share. Guests open the link, no app or signup." />
            <Feature icon={<ShieldCheck className="h-5 w-5" />} title="Private by design" desc="Selfies are processed on-device. Guests only see photos that match them." />
          </div>
        </section>
      </main>
      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        PhotoFlow · MVP
      </footer>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground mt-2">{desc}</p>
    </div>
  );
}
