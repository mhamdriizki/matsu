import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kurs Watch",
  description: "BCA e-Rate watcher",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
