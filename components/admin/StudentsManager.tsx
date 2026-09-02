"use client";

import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { StudentsTable } from "@/components/admin/StudentsTable";
import { StudentDetailModal } from "@/components/admin/StudentDetailModal";
import { cn } from "@/lib/utils";
import type { Estudiante, HistorialClub } from "@/types";

interface StudentsManagerProps {
  estudiantes: Estudiante[];
  clubPorEstudiante: Map<string, string>;
  historial: HistorialClub[];
  initialMatricula?: string;
}

export function StudentsManager({ estudiantes, clubPorEstudiante, historial, initialMatricula }: StudentsManagerProps) {
  const initial = initialMatricula ? (estudiantes.find((e) => e.matricula === initialMatricula) ?? null) : null;
  const [selectedId, setSelectedId] = useState<string | null>(initial?.id ?? null);
  const [soloSinClub, setSoloSinClub] = useState(false);

  const estudiante = estudiantes.find((e) => e.id === selectedId) ?? null;
  const historialEstudiante = estudiante
    ? historial
        .filter((h) => h.estudianteId === estudiante.id)
        .sort((a, b) => b.fechaFin.localeCompare(a.fechaFin))
    : [];

  const sinClubCount = useMemo(
    () => estudiantes.filter((e) => !clubPorEstudiante.has(e.id)).length,
    [estudiantes, clubPorEstudiante],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full bg-gray-100 p-1 dark:bg-neutral-800">
          <button
            type="button"
            onClick={() => setSoloSinClub(false)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              !soloSinClub ? "bg-white text-red-700 shadow-sm dark:bg-neutral-950 dark:text-red-400" : "text-gray-500 dark:text-gray-400",
            )}
          >
            Todos ({estudiantes.length})
          </button>
          <button
            type="button"
            onClick={() => setSoloSinClub(true)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              soloSinClub ? "bg-white text-red-700 shadow-sm dark:bg-neutral-950 dark:text-red-400" : "text-gray-500 dark:text-gray-400",
            )}
          >
            Sin club ({sinClubCount})
          </button>
        </div>

        <a
          href={`/api/estudiantes/export-pdf${soloSinClub ? "?sinClub=1" : ""}`}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-200 dark:hover:bg-neutral-800"
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          Exportar a PDF
        </a>
      </div>

      <StudentsTable
        estudiantes={estudiantes}
        clubPorEstudiante={clubPorEstudiante}
        soloSinClub={soloSinClub}
        onSelect={(e) => setSelectedId(e.id)}
      />
      <StudentDetailModal
        estudiante={estudiante}
        clubActualNombre={estudiante ? (clubPorEstudiante.get(estudiante.id) ?? null) : null}
        historial={historialEstudiante}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
