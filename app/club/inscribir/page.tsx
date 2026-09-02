import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { QuickEnrollPanel } from "@/components/shared/QuickEnrollPanel";
import { getClubById, getClubes } from "@/lib/db/clubes";
import { getEstudiantes } from "@/lib/db/estudiantes";

export const dynamic = "force-dynamic";

export default async function ClubInscribirPage() {
  const session = await auth();
  if (!session?.user.clubId) redirect("/login");

  const [club, clubes, estudiantes] = await Promise.all([
    getClubById(session.user.clubId),
    getClubes(),
    getEstudiantes(),
  ]);
  if (!club) redirect("/login");

  const clubPorEstudiante = new Map<string, string>();
  for (const c of clubes) {
    for (const id of c.miembrosActuales) clubPorEstudiante.set(id, c.nombre);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">Inscribir estudiante</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Busca al estudiante por su matrícula o nombre e inscríbelo en {club.nombre} al instante.
        </p>
      </div>
      <QuickEnrollPanel
        scope="club"
        estudiantes={estudiantes}
        clubPorEstudiante={clubPorEstudiante}
        clubActual={{
          id: club.id,
          nombre: club.nombre,
          capacidadMaxima: club.capacidadMaxima,
          miembrosActuales: club.miembrosActuales.length,
        }}
      />
    </div>
  );
}
