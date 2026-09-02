import { QuickEnrollPanel } from "@/components/shared/QuickEnrollPanel";
import { getClubes } from "@/lib/db/clubes";
import { getEstudiantes } from "@/lib/db/estudiantes";

export const dynamic = "force-dynamic";

export default async function AdminInscribirPage() {
  const [clubes, estudiantes] = await Promise.all([getClubes(), getEstudiantes()]);

  const clubPorEstudiante = new Map<string, string>();
  for (const c of clubes) {
    for (const id of c.miembrosActuales) clubPorEstudiante.set(id, c.nombre);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">Inscribir estudiante</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Busca al estudiante, elige el club y regístralo al instante.
        </p>
      </div>
      <QuickEnrollPanel
        scope="admin"
        estudiantes={estudiantes}
        clubPorEstudiante={clubPorEstudiante}
        clubes={clubes.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          capacidadMaxima: c.capacidadMaxima,
          miembrosActuales: c.miembrosActuales.length,
        }))}
      />
    </div>
  );
}
