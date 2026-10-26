import type { Metadata } from "next";
import "./globals.css";
import "./dashboard.css";
import "./tables.css";
import "./workflows.css";
import "./cadences.css";
import "./settings.css";
import "./auth.css";
import "./reference-ui.css";
import "./audit-reference.css";
import "./settings-reference.css";
import "./linkedin-reference.css";
import "./auth-reference.css";
import "./registration-reference.css";
import "./entry-reference.css";
import "./dashboard-reference.css";
import "./prospecting-reference.css";
import "./workflows-reference.css";
import "./reports-reference.css";
import "./remaining-reference.css";
import "./visual-detail-refinements.css";
import "./theme-reference.css";
import "./cadence-insights-reference.css";
import "./step-reference.css";
import "./integration-promo-reference.css";
import "./funnel-reference.css";
import "./prospecting-final-reference.css";
import "./sdr-reference.css";
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
