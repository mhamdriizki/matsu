import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-56 w-full rounded-2xl" />
      <Skeleton className="h-80 w-full rounded-2xl" />
    </main>
  );
}
