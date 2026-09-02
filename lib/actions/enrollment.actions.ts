"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { readJson, writeJson, withFileLock } from "@/lib/db/base";
import { getEstudianteById } from "@/lib/db/estudiantes";
import type { Club } from "@/types";
import { actionOk, actionError, type ActionResult } from "./types";

const CLUBES_FILE = "clubes.json";

export interface InscribirInput {
  estudianteId: string;
  clubId?: string; // requerido solo si quien inscribe es pastoral (el encargado de club usa el suyo)
}

function rutasAfectadas(clubId: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/clubes");
  revalidatePath("/admin/estudiantes");
  revalidatePath("/admin/inscribir");
  revalidatePath("/club");
  revalidatePath("/club/miembros");
  revalidatePath("/club/inscribir");
  revalidatePath("/club/asistencia");
  void clubId;
}

/**
 * Inscribe a un estudiante ya existente en el listado a un club. Es la vía
 * rápida usada por encargados de club (su propio club) y por el encargado de
 * pastoral (elige el club) para registrar estudiantes en persona, uno tras
 * otro. Toda la operación de lectura-verificación-escritura corre dentro de
 * un único withFileLock sobre clubes.json — evita perder inscripciones si
 * varios encargados registran al mismo tiempo.
 */
export async function inscribirEstudiante(input: InscribirInput): Promise<ActionResult<{ clubNombre: string }>> {
  const session = await auth();
  if (!session || (session.user.rol !== "pastoral" && session.user.rol !== "encargado_club")) {
    return actionError("No tienes permiso para inscribir estudiantes.");
  }

  let targetClubId: string;
  if (session.user.rol === "encargado_club") {
    if (!session.user.clubId) return actionError("Tu cuenta no tiene un club asignado.");
    targetClubId = session.user.clubId;
  } else {
    if (!input.clubId) return actionError("Selecciona un club.");
    targetClubId = input.clubId;
  }

  const estudiante = await getEstudianteById(input.estudianteId);
  if (!estudiante) return actionError("Ese estudiante no existe en el listado vigente.");

  return withFileLock(CLUBES_FILE, async () => {
    const clubes = await readJson<Club[]>(CLUBES_FILE, []);
    const target = clubes.find((c) => c.id === targetClubId);
    if (!target) return actionError("El club no existe.");

    const yaEnClub = clubes.find((c) => c.miembrosActuales.includes(estudiante.id));
    if (yaEnClub) {
      return actionError(
        yaEnClub.id === target.id
          ? `${estudiante.nombre} ${estudiante.apellido} ya está en este club.`
          : `${estudiante.nombre} ${estudiante.apellido} ya está en "${yaEnClub.nombre}".`,
      );
    }

    if (target.miembrosActuales.length >= target.capacidadMaxima) {
      return actionError(`"${target.nombre}" ya no tiene cupo disponible.`);
    }

    const next = clubes.map((c) =>
      c.id === target.id ? { ...c, miembrosActuales: [...c.miembrosActuales, estudiante.id] } : c,
    );
    await writeJson(CLUBES_FILE, next);

    rutasAfectadas(target.id);
    return actionOk({ clubNombre: target.nombre });
  });
}
