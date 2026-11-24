import * as React from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Toaster } from "@/components/ui/sonner";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthShell>
      {children}
      <Toaster position="top-center" richColors closeButton />
    </AuthShell>
  );
}
