import type { Metadata } from "next";
import "@/index.css";

export const metadata: Metadata = {
  title: "Kash",
  description: "Kash Spending Tracker",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
