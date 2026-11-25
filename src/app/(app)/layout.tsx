import * as React from "react";
import { AppShell } from "@/components/layout/app-shell";
import { tryCreateClient } from "@/lib/supabase/server";
import { AuthenticatedProviders } from "./authenticated-providers";

export default async function AuthenticatedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let initialUserId: string | null = null;

  try {
    const supabase = await tryCreateClient();
    if (supabase) {
      const { data } = await supabase.auth.getUser();
      initialUserId = data.user?.id ?? null;
    }
  } catch {
    initialUserId = null;
  }

  return (
    <AuthenticatedProviders initialUserId={initialUserId}>
      <AppShell initialUserId={initialUserId}>{children}</AppShell>
    </AuthenticatedProviders>
  );
}
