import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Foundry — AI Deployment Platform",
  description: "Turn one sentence into a fully deployed project.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div className="relative flex min-h-screen flex-col">{children}</div>
      </body>
    </html>
  );
}
