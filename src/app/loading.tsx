import { Skeleton } from "@/components/ui/skeleton";

export default function RootLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="bg-background mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6"
    >
      <Skeleton className="h-10 w-48 rounded-lg" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  );
}
