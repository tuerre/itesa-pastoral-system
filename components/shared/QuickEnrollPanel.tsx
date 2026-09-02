"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, Search, UserCheck, UserPlus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { inscribirEstudiante } from "@/lib/actions/enrollment.actions";
import type { Estudiante } from "@/types";

interface ClubOpcion {
  id: string;
  nombre: string;
  capacidadMaxima: number;
  miembrosActuales: number;
}

interface QuickEnrollPanelProps {
  scope: "club" | "admin";
  estudiantes: Estudiante[];
  clubPorEstudiante: Map<string, string>;
  clubActual?: ClubOpcion;
  clubes?: ClubOpcion[];
}

function normalizar(texto: string) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function QuickEnrollPanel({ scope, estudiantes, clubPorEstudiante: clubPorEstudianteInicial, clubActual, clubes = [] }: QuickEnrollPanelProps) {
  const [query, setQuery] = useState("");
  const [curso, setCurso] = useState("todos");
  const [clubDestinoId, setClubDestinoId] = useState(clubActual?.id ?? clubes[0]?.id ?? "");
  const [seleccionado, setSeleccionado] = useState<Estudiante | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [clubPorEstudiante, setClubPorEstudiante] = useState<Map<string, string>>(clubPorEstudianteInicial);
  const [cuposLocal, setCuposLocal] = useState<Record<string, number>>(() =>
    Object.fromEntries([...(clubActual ? [clubActual] : []), ...clubes].map((c) => [c.id, c.miembrosActuales])),
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setClubPorEstudiante(clubPorEstudianteInicial);
  }, [clubPorEstudianteInicial]);

  const cursos = useMemo(() => Array.from(new Set(estudiantes.map((e) => e.curso))).sort(), [estudiantes]);

  const resultados = useMemo(() => {
    const q = normalizar(query.trim());
    if (q.length < 1) return [];
    let pool = estudiantes;
    if (curso !== "todos") pool = pool.filter((e) => e.curso === curso);
    return pool
      .filter((e) => normalizar(`${e.nombre} ${e.apellido} ${e.matricula}`).includes(q))
      .slice(0, 8);
  }, [estudiantes, curso, query]);

  const clubObjetivo = scope === "club" ? clubActual : clubes.find((c) => c.id === clubDestinoId);
  const cupoActual = clubObjetivo ? (cuposLocal[clubObjetivo.id] ?? clubObjetivo.miembrosActuales) : 0;
  const cupoLleno = clubObjetivo ? cupoActual >= clubObjetivo.capacidadMaxima : false;

  function elegir(estudiante: Estudiante) {
    setSeleccionado(estudiante);
  }

  function cancelarSeleccion() {
    setSeleccionado(null);
    setQuery("");
    inputRef.current?.focus();
  }

  async function confirmarInscripcion() {
    if (!seleccionado || !clubObjetivo) return;
    setIsPending(true);
    const res = await inscribirEstudiante({
      estudianteId: seleccionado.id,
      clubId: scope === "admin" ? clubObjetivo.id : undefined,
    });
    setIsPending(false);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }

    toast.success(`${seleccionado.nombre} ${seleccionado.apellido} inscrito en ${res.data.clubNombre}.`);
    setClubPorEstudiante((prev) => new Map(prev).set(seleccionado.id, res.data.clubNombre));
    setCuposLocal((prev) => ({ ...prev, [clubObjetivo.id]: (prev[clubObjetivo.id] ?? clubObjetivo.miembrosActuales) + 1 }));
    setSeleccionado(null);
    setQuery("");
    inputRef.current?.focus();
  }

  const estudianteYaTieneClub = seleccionado ? clubPorEstudiante.get(seleccionado.id) : undefined;

  return (
    <div className="space-y-4">
      {scope === "admin" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Inscribir en el club
          </label>
          <Select value={clubDestinoId} onValueChange={setClubDestinoId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un club" />
            </SelectTrigger>
            <SelectContent>
              {clubes.map((c) => {
                const cupo = cuposLocal[c.id] ?? c.miembrosActuales;
                return (
                  <SelectItem key={c.id} value={c.id} disabled={cupo >= c.capacidadMaxima}>
                    {c.nombre} — {cupo}/{c.capacidadMaxima} {cupo >= c.capacidadMaxima ? "(lleno)" : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      {scope === "club" && clubActual && (
        <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-sm text-gray-600 dark:text-gray-400">Inscribiendo en</span>
          <Badge variant={cupoLleno ? "destructive" : "brand"}>
            {clubActual.nombre} · {cupoActual}/{clubActual.capacidadMaxima}
          </Badge>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden="true" />
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSeleccionado(null);
              }}
              placeholder="Matrícula o nombre del estudiante"
              className="h-12 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-4 text-base text-gray-800 outline-none transition-colors focus:border-red-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-gray-100 dark:focus:border-red-600"
            />
          </div>
          <div className="sm:w-48">
            <Select value={curso} onValueChange={setCurso}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Curso" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los cursos</SelectItem>
                {cursos.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {query.trim().length > 0 && !seleccionado && (
          <div className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 dark:divide-neutral-800 dark:border-neutral-800">
            {resultados.length === 0 && (
              <p className="px-4 py-4 text-center text-sm text-gray-400 dark:text-gray-500">
                No se encontró ningún estudiante con ese dato.
              </p>
            )}
            {resultados.map((e) => {
              const clubDeEstudiante = clubPorEstudiante.get(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => elegir(e)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {e.nombre} {e.apellido}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {e.curso} · {e.matricula}
                    </p>
                  </div>
                  {clubDeEstudiante ? (
                    <Badge variant="secondary" className="shrink-0">
                      En {clubDeEstudiante}
                    </Badge>
                  ) : (
                    <Badge variant="success" className="shrink-0">
                      Sin club
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {seleccionado && (
        <div className="rounded-2xl border-2 border-brand/30 bg-brand/5 p-5 dark:bg-brand/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-brand">Confirmar inscripción</p>
              <h3 className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                {seleccionado.nombre} {seleccionado.apellido}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {seleccionado.curso} · Matrícula {seleccionado.matricula}
              </p>
            </div>
            <button
              type="button"
              onClick={cancelarSeleccion}
              className="shrink-0 text-sm font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            >
              Cancelar
            </button>
          </div>

          {estudianteYaTieneClub ? (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-200">
              Ya está inscrito en <strong>{estudianteYaTieneClub}</strong>. Para moverlo, primero quítalo de ese club.
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Se inscribirá en <strong>{clubObjetivo?.nombre}</strong>
                {clubObjetivo && ` (${cupoActual}/${clubObjetivo.capacidadMaxima})`}
              </p>
              <button
                type="button"
                onClick={confirmarInscripcion}
                disabled={isPending || cupoLleno || !clubObjetivo}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60",
                )}
                style={{ background: "linear-gradient(135deg, #c0392b, #922b21)" }}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UserCheck className="h-4 w-4" aria-hidden="true" />
                )}
                {cupoLleno ? "Sin cupo" : "Inscribir"}
              </button>
            </div>
          )}
        </div>
      )}

      {!seleccionado && query.trim().length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400 dark:border-neutral-700 dark:text-gray-500">
          <UserPlus className="h-6 w-6" aria-hidden="true" />
          Escribe la matrícula o el nombre para buscar al estudiante.
        </div>
      )}
    </div>
  );
}
