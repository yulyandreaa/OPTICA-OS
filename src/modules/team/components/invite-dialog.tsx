"use client";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { inviteMemberAction } from "../actions";

export function InviteDialog({ roles, branches }: { roles: { id: string; name: string; code: string }[]; branches: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await inviteMemberAction({ email: String(fd.get("email")), roleId: String(fd.get("roleId")), branchId: String(fd.get("branchId") ?? "") });
      if (!res.ok) { setError(res.error); return; }
      setError(null);
      setLink(res.data.link);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setLink(null); setCopied(false); setError(null); } }}>
      <DialogTrigger render={<Button />}><UserPlus /> Invitar</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitar a tu equipo</DialogTitle>
          <DialogDescription>El permiso por sede limita lo que la persona ve: por ejemplo, recepción de una sola sede.</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="grid gap-3">
            <p className="text-sm">Comparte este enlace de un solo uso (vence en 7 días):</p>
            <div className="flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" size="icon" aria-label="Copiar enlace"
                onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); toast.success("Enlace copiado"); }}>
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <Button variant="ghost" onClick={() => setLink(null)}>Invitar a otra persona</Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4">
            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive">{error}</p>}
            <FormField id="email" label="Correo"><Input id="email" name="email" type="email" required placeholder="nombre@optica.com" /></FormField>
            <FormField id="roleId" label="Rol">
              <NativeSelect id="roleId" name="roleId" defaultValue={roles.find((r) => r.code === "RECEPTIONIST")?.id}>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="branchId" label="Alcance">
              <NativeSelect id="branchId" name="branchId" defaultValue="">
                <option value="">Todas las sedes</option>
                {branches.map((b) => <option key={b.id} value={b.id}>Solo {b.name}</option>)}
              </NativeSelect>
            </FormField>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Crear invitación</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
