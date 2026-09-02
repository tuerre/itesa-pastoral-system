import { Users, Shapes, AlertTriangle, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/admin/StatCard";
import { OccupancyChart } from "@/components/admin/OccupancyChart";
import { getClubes } from "@/lib/db/clubes";
import { getEstudiantes } from "@/lib/db/estudiantes";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const [clubes, estudiantes] = await Promise.all([getClubes(), getEstudiantes()]);

  const idsConClub = new Set(clubes.flatMap((c) => c.miembrosActuales));
  const sinClub = estudiantes.filter((e) => !idsConClub.has(e.id)).length;
  const clubesLlenos = clubes.filter((c) => c.miembrosActuales.length >= c.capacidadMaxima).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">Panel general</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Resumen del estado actual de los clubes y los estudiantes.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Estudiantes en el listado" value={estudiantes.length} icon={Users} accent="neutral" />
        <StatCard
          label="Sin club asignado"
          value={sinClub}
          icon={AlertTriangle}
          accent={sinClub > 0 ? "warning" : "success"}
        />
        <StatCard label="Clubes activos" value={clubes.length} icon={Shapes} accent="neutral" />
        <StatCard label="Clubes con cupo lleno" value={clubesLlenos} icon={UserPlus} accent="neutral" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ocupación por club</CardTitle>
        </CardHeader>
        <CardContent>
          <OccupancyChart clubes={clubes} />
        </CardContent>
      </Card>
    </div>
  );
}
