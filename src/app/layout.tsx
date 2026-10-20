import type { Metadata } from "next";
import "./globals.css";
import "./dashboard.css";
import "./tables.css";
import "./workflows.css";
import "./cadences.css";
import "./settings.css";
import "./auth.css";
export const metadata: Metadata = {
  title: "Prometeus Cadence · Prospecção inteligente",
  description: "Prospecção, qualificação e cadências em um só lugar.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
