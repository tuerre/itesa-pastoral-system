import { redirect } from "next/navigation";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { auth } from "@/lib/auth";
import { MembersList } from "@/components/club/MembersList";
import { getClubById } from "@/lib/db/clubes";
import { getEstudiantesByIds } from "@/lib/db/estudiantes";

export const dynamic = "force-dynamic";

export default async function ClubMiembrosPage() {
  const session = await auth();
  if (!session?.user.clubId) redirect("/login");

  const club = await getClubById(session.user.clubId);
  if (!club) redirect("/login");

  const miembros = await getEstudiantesByIds(club.miembrosActuales);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">Miembros del club</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{club.nombre}</p>
        </div>
        <Link
          href="/club/inscribir"
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #c0392b, #922b21)" }}
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Inscribir estudiante
        </Link>
      </div>
      <MembersList miembros={miembros} />
    </div>
  );
}
