import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Home() {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold text-foreground mb-6">Kash</h1>
        <p className="text-muted-foreground mb-8">
          <Link
            href="https://github.com/kashyap/kash-spending-tracker"
            target="_blank"
            rel="noopener noreferrer"
          >
            Kash Spending Tracker - Track your spending habits and manage your
            finances.
          </Link>
        </p>
        <Button>Get Started</Button>
      </div>
    </main>
  );
}
