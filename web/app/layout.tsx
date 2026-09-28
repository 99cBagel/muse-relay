import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Muse Relay",
  description: "Browser chat UI relayed through the Muse-Relay-Worker to your processing backend.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
