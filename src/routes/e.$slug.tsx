import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/e/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — PhotoFlow` },
      { name: "description", content: "Find your photos from this event." },
    ],
  }),
  component: () => <Outlet />,
});