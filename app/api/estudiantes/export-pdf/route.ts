import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEstudiantes } from "@/lib/db/estudiantes";
import { getClubes } from "@/lib/db/clubes";
import { generarPdfEstudiantes, type FilaEstudiantePdf } from "@/lib/reportes/estudiantes-pdf";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.rol !== "pastoral") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const soloSinClub = req.nextUrl.searchParams.get("sinClub") === "1";

  const [estudiantes, clubes] = await Promise.all([getEstudiantes(), getClubes()]);
  const clubPorEstudiante = new Map<string, string>();
  for (const club of clubes) {
    for (const id of club.miembrosActuales) clubPorEstudiante.set(id, club.nombre);
  }

  let filas: FilaEstudiantePdf[] = estudiantes
    .slice()
    .sort((a, b) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`))
    .map((estudiante) => ({ estudiante, clubNombre: clubPorEstudiante.get(estudiante.id) ?? null }));

  if (soloSinClub) {
    filas = filas.filter((f) => !f.clubNombre);
  }

  const buffer = await generarPdfEstudiantes(filas, {
    titulo: soloSinClub ? "Estudiantes sin club asignado" : "Listado de estudiantes",
    subtitulo: `${filas.length} estudiante${filas.length === 1 ? "" : "s"}${soloSinClub ? " sin club" : ""}`,
  });

  const fecha = new Date().toISOString().slice(0, 10);
  const filename = `estudiantes_${soloSinClub ? "sin-club_" : ""}${fecha}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
