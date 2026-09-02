"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Shuffle, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteUsuarioEncargado, resetPasswordEncargado } from "@/lib/actions/users.actions";
import { TIPO_PERSONA_LABEL } from "@/lib/constants";
import { generarPassword } from "@/lib/utils";
import type { Club, Usuario } from "@/types";

interface UsersManagementTableProps {
  encargados: Usuario[];
  clubesMap: Map<string, Club>;
}

export function UsersManagementTable({ encargados, clubesMap }: UsersManagementTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [resetTarget, setResetTarget] = useState<Usuario | null>(null);
  const [nuevaPasswordInput, setNuevaPasswordInput] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [errorPassword, setErrorPassword] = useState<string | null>(null);
  const [confirmada, setConfirmada] = useState<{ username: string; password: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  function abrirReset(usuario: Usuario) {
    setResetTarget(usuario);
    setNuevaPasswordInput("");
    setErrorPassword(null);
    setMostrarPassword(false);
  }

  function confirmarReset() {
    if (!resetTarget) return;
    if (nuevaPasswordInput.length < 6) {
      setErrorPassword("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    startTransition(async () => {
      const res = await resetPasswordEncargado(resetTarget.id, nuevaPasswordInput);
      if (!res.ok) {
        setErrorPassword(res.error);
        return;
      }
      setConfirmada({ username: resetTarget.username, password: res.data.password });
      setResetTarget(null);
      router.refresh();
    });
  }

  function handleDelete(usuarioId: string) {
    startTransition(async () => {
      const res = await deleteUsuarioEncargado(usuarioId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Encargado eliminado.");
      router.refresh();
    });
  }

  async function copiar() {
    if (!confirmada) return;
    await navigator.clipboard.writeText(confirmada.password);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  if (encargados.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center text-sm text-gray-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-400">
        Todavía no has creado ningún encargado de club.
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Club</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {encargados.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium text-gray-900 dark:text-white">{u.nombre}</TableCell>
                <TableCell className="text-sm text-gray-600 dark:text-gray-400">{u.username}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{TIPO_PERSONA_LABEL[u.tipoPersona ?? "estudiante"]}</Badge>
                </TableCell>
                <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                  {u.clubId ? clubesMap.get(u.clubId)?.nombre ?? "—" : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Restablecer contraseña de ${u.nombre}`} onClick={() => abrirReset(u)}>
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Eliminar a ${u.nombre}`}>
                          <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Eliminar a {u.nombre}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Perderá acceso al panel de su club de inmediato. Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(u.id)}>Eliminar</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!resetTarget} onOpenChange={(v) => !v && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restablecer contraseña</DialogTitle>
            <DialogDescription>
              Escribe la nueva contraseña para {resetTarget?.nombre}. Debe tener al menos 6 caracteres.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-6 py-6">
            <Label htmlFor="nuevaPassword">Nueva contraseña</Label>
            <div className="relative">
              <Input
                id="nuevaPassword"
                type={mostrarPassword ? "text" : "password"}
                value={nuevaPasswordInput}
                onChange={(e) => {
                  setNuevaPasswordInput(e.target.value);
                  setErrorPassword(null);
                }}
                invalid={!!errorPassword}
                placeholder="Mínimo 6 caracteres"
                className="pr-20"
              />
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setMostrarPassword((v) => !v)}
                  aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-neutral-800"
                >
                  {mostrarPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNuevaPasswordInput(generarPassword());
                    setMostrarPassword(true);
                  }}
                  aria-label="Generar contraseña aleatoria"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-neutral-800"
                >
                  <Shuffle className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            {errorPassword && (
              <p role="alert" className="text-sm text-destructive">
                {errorPassword}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResetTarget(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={confirmarReset} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Guardar contraseña
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmada} onOpenChange={(v) => !v && setConfirmada(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Contraseña actualizada</AlertDialogTitle>
            <AlertDialogDescription>Comparte esta contraseña de forma segura con el encargado.</AlertDialogDescription>
          </AlertDialogHeader>
          {confirmada && (
            <div className="mx-6 my-6 space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-4 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900">
              <p>
                Usuario: <span className="font-semibold">{confirmada.username}</span>
              </p>
              <p>
                Nueva contraseña: <span className="font-semibold">{confirmada.password}</span>
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <Button variant="outline" onClick={copiar}>
              {copiado ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copiado ? "Copiado" : "Copiar"}
            </Button>
            <AlertDialogAction onClick={() => setConfirmada(null)}>Listo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
