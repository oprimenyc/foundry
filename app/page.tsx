import { redirect } from "next/navigation";

// force-dynamic so the redirect is a real 307 + Location header at request
// time; statically prerendered redirects ship meta-refresh HTML with no
// Location, which breaks curl/fetch/health-check clients.
export const dynamic = "force-dynamic";

export default function Home() {
  redirect("/projects/new");
}
