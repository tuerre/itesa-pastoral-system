# Migración a Supabase — Guía paso a paso

Este documento describe **todo** lo que hay que hacer para migrar el sistema de
Pastoral de su almacenamiento actual (archivos JSON en `data/db/`) a una base
de datos Supabase (Postgres + Auth + Storage), en tres fases: **antes**,
**durante** y **después**. Incluye el esquema SQL completo, el inventario de
todo lo que se debe migrar y un script de migración de datos.

> **Estado de esta migración en este repo:** este documento es el plan. El
> código de la app (`lib/db/*.ts`, `lib/actions/*.ts`, `lib/auth.ts`) todavía
> lee y escribe `data/db/*.json` — **no se ha ejecutado ningún cambio de
> esquema ni de código todavía**. Ver la sección "Por qué el plan y no la
> ejecución" al final.

---

## 0. Inventario — qué se migra

| Archivo actual (`data/db/`)  | Se convierte en                                        | Notas |
|---|---|---|
| `estudiantes.json`           | tabla `estudiantes`                                    | roster vigente del año escolar |
| `clubes.json`                | tabla `clubes` (+ `club_miembros` normalizada)          | `cicloActual` pasa a columnas propias |
| `usuarios.json`               | tabla `usuarios`                                        | login sigue siendo por `username`, no por email (ver §4) |
| `asistencias.json`           | tabla `asistencias` + `asistencia_registros`            | hoy es un JSON anidado; se normaliza a 2 tablas |
| `historial.json`             | tabla `historial_club`                                  | ya tiene `cicloNumero`, se conserva tal cual |
| `meta.json`                  | tabla `meta_anio_escolar` (o fila única en `meta`)      | año escolar vigente |
| `public/uploads/clubs/*.jpg` | bucket de Storage `club-fotos`                          | hoy son archivos en disco servidos por Next |
| `public/branding/logo-report.png` | se queda en `/public` (no es dato de usuario)      | usado por los exports de Excel/PDF, no migra |
| `data/db/backups/*`          | ya no aplica                                            | Postgres tiene sus propios backups/point-in-time recovery |

También hay que revisar (no son datos, pero dependen de cómo se guardan los datos):

- `lib/db/base.ts` (`readJson`, `writeJson`, `withFileLock`) — se elimina por completo. El *file locking* manual que evita condiciones de carrera en `clubes.json` deja de ser necesario: Postgres resuelve la concurrencia con transacciones y constraints (ver §3.6).
- Los **9 módulos** en `lib/db/*.ts` (`clubes.ts`, `estudiantes.ts`, `usuarios.ts`, `asistencias.ts`, `historial.ts`, `meta.ts`) — se reescriben para usar el cliente de Supabase.
- Los **8 módulos** en `lib/actions/*.ts` (`clubs.actions.ts`, `students.actions.ts`, `users.actions.ts`, `attendance.actions.ts`, `enrollment.actions.ts`) — igual, cambian sus llamadas internas pero mantienen la misma firma pública (`ActionResult<T>`), así que los componentes de UI **no cambian**.
- `lib/auth.ts` / `lib/auth.config.ts` — el `Credentials` provider pasa de leer `usuarios.json` a consultar la tabla `usuarios`.
- `lib/reportes/asistencia.ts` y `lib/reportes/estudiantes-pdf.ts` / `asistencia-excel.ts` — la parte de generación de Excel/PDF no cambia; solo cambia de dónde sacan los datos (antes `getAsistencias()` leía un JSON, después hace un `select` a Supabase).
- `scripts/seed.ts` — se reemplaza por las migraciones SQL + un script de carga inicial (§3.7).

---

## 1. Antes de empezar (prerrequisitos)

1. **Crear el proyecto en Supabase** (https://supabase.com/dashboard) — anota:
   - Project URL (`https://<ref>.supabase.co`)
   - `anon` / publishable key (para el cliente en el navegador)
   - `service_role` key (solo servidor, **nunca** en el cliente ni en un commit)
2. **Instalar el CLI de Supabase** y enlazar el proyecto:
   ```bash
   pnpm add -D supabase
   npx supabase login
   npx supabase init
   npx supabase link --project-ref <ref>
   ```
3. **Instalar el cliente JS**:
   ```bash
   pnpm add @supabase/supabase-js @supabase/ssr
   ```
4. **Variables de entorno** — agregar a `.env.local` (y a `.env.example` sin los valores reales):
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # solo en server actions / route handlers
   ```
5. **Decidir la estrategia de autenticación** (ver §4) antes de escribir el esquema, porque afecta si `usuarios.id` referencia `auth.users(id)` o es una tabla 100% propia. Recomendación de este documento: **mantener NextAuth + tabla `usuarios` propia** (no usar Supabase Auth) — ver justificación en §4.
6. **Hacer un backup** de `data/db/*.json` tal cual están hoy (cópialos fuera del repo, o usa `git log` — ya están versionados si se hizo un commit reciente). Este backup es la fuente de verdad para la migración de datos y el plan de rollback.
7. **Congelar escrituras**: avisa a los encargados que no usen el sistema mientras se hace el corte (§3.8) — la inscripción rápida (`/club/inscribir`, `/admin/inscribir`) y el pase de lista son las páginas que más escriben.

---

## 2. Esquema SQL (Postgres)

Crear como una migración de Supabase:

```bash
npx supabase migration new init_schema
```

Y pegar esto en el archivo generado (`supabase/migrations/<timestamp>_init_schema.sql`):

```sql
-- ============================================================
-- Extensiones
-- ============================================================
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================
-- meta: una sola fila con el año escolar vigente
-- ============================================================
create table meta_anio_escolar (
  id smallint primary key default 1 check (id = 1), -- fuerza fila única
  anio_actual text not null,
  fecha_ultima_carga_roster date,
  total_estudiantes integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- estudiantes: roster vigente del año escolar
-- ============================================================
create table estudiantes (
  id text primary key,                 -- = matrícula (se conserva el mismo id que hoy)
  nombre text not null,
  apellido text not null,
  curso text not null,
  matricula text not null unique,
  anio_escolar text not null,
  created_at timestamptz not null default now()
);
create index idx_estudiantes_matricula on estudiantes (matricula);
create index idx_estudiantes_curso on estudiantes (curso);

-- ============================================================
-- usuarios: encargados de pastoral y de club (login del panel)
-- ============================================================
create table usuarios (
  id text primary key default gen_random_uuid()::text,
  nombre text not null,
  username text not null unique,
  password_hash text not null,
  rol text not null check (rol in ('pastoral', 'encargado_club')),
  tipo_persona text check (tipo_persona in ('estudiante', 'profesor')),
  club_id text,                        -- FK se agrega tras crear "clubes" (referencia circular)
  created_at timestamptz not null default now()
);
create index idx_usuarios_username on usuarios (lower(username));

-- ============================================================
-- clubes
-- ============================================================
create table clubes (
  id text primary key default gen_random_uuid()::text,
  nombre text not null,
  descripcion text not null default '',
  foto_url text,                       -- URL pública del bucket "club-fotos"
  capacidad_maxima integer not null check (capacidad_maxima > 0),
  duracion_meses integer not null check (duracion_meses > 0),
  encargado_usuario_id text references usuarios (id) on delete set null,
  ciclo_numero integer not null default 1,
  ciclo_fecha_inicio date not null default current_date,
  ciclo_anio_escolar text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table usuarios
  add constraint fk_usuarios_club foreign key (club_id) references clubes (id) on delete set null;

-- ============================================================
-- club_miembros: quién está en qué club AHORA MISMO
-- (antes era el array clubes.miembrosActuales)
-- ============================================================
create table club_miembros (
  club_id text not null references clubes (id) on delete cascade,
  estudiante_id text not null references estudiantes (id) on delete cascade,
  fecha_ingreso date not null default current_date,
  primary key (estudiante_id)          -- ¡clave! un estudiante solo puede estar en UN club a la vez
);
create index idx_club_miembros_club on club_miembros (club_id);

-- La restricción "un estudiante = un club" (que hoy se valida a mano en
-- lib/actions/enrollment.actions.ts) queda GARANTIZADA por la base de datos:
-- primary key (estudiante_id) hace imposible insertar al mismo estudiante
-- en dos clubes. Ya no se necesita ese chequeo manual "yaEnClub".

-- ============================================================
-- historial_club: membresías archivadas cuando termina un ciclo
-- ============================================================
create table historial_club (
  id text primary key default gen_random_uuid()::text,
  estudiante_id text not null references estudiantes (id) on delete cascade,
  club_id text not null references clubes (id) on delete cascade,
  club_nombre text not null,           -- snapshot, por si el club se renombra/elimina luego
  anio_escolar text not null,
  ciclo_numero integer not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  motivo_archivo text not null check (motivo_archivo in ('nuevo_ciclo', 'nuevo_anio_escolar')),
  created_at timestamptz not null default now()
);
create index idx_historial_estudiante on historial_club (estudiante_id);
create index idx_historial_club on historial_club (club_id, ciclo_numero);

-- ============================================================
-- asistencias: una fila por sesión (antes: un objeto en asistencias.json)
-- ============================================================
create table asistencias (
  id text primary key default gen_random_uuid()::text,
  club_id text not null references clubes (id) on delete cascade,
  fecha date not null,
  tomada_por_usuario_id text not null references usuarios (id),
  anio_escolar text not null,
  created_at timestamptz not null default now(),
  unique (club_id, fecha)              -- upsert por (club, fecha), igual que hoy
);

create table asistencia_registros (
  asistencia_id text not null references asistencias (id) on delete cascade,
  estudiante_id text not null references estudiantes (id) on delete cascade,
  presente boolean not null,
  primary key (asistencia_id, estudiante_id)
);
create index idx_asistencia_registros_estudiante on asistencia_registros (estudiante_id);

-- ============================================================
-- Row Level Security — todo el acceso pasa por Server Actions / Route
-- Handlers que usan la service_role key (bypassa RLS), así que estas
-- políticas son una red de seguridad, no el mecanismo principal de acceso.
-- ============================================================
alter table estudiantes enable row level security;
alter table usuarios enable row level security;
alter table clubes enable row level security;
alter table club_miembros enable row level security;
alter table historial_club enable row level security;
alter table asistencias enable row level security;
alter table asistencia_registros enable row level security;
alter table meta_anio_escolar enable row level security;

-- Con RLS activado y SIN policies, nadie puede leer/escribir usando el
-- anon key — que es justo lo que queremos, porque este proyecto no llama a
-- Supabase desde el navegador, solo desde el servidor con la service_role key.
```

### 2.1 Storage (fotos de clubes)

```sql
insert into storage.buckets (id, name, public)
values ('club-fotos', 'club-fotos', true);

create policy "Lectura pública de fotos de clubes"
  on storage.objects for select
  using (bucket_id = 'club-fotos');

-- Sin policy de insert/update/delete para el rol anon: las subidas siguen
-- pasando por el server action (guardarFotoClub), que usa la service_role key.
```

---

## 3. Durante la migración

### 3.1 Orden recomendado

1. Aplicar la migración de esquema (§2) en un proyecto Supabase de **staging** primero, nunca directo en producción.
2. Escribir y probar el script de carga de datos (§3.7) contra staging.
3. Reescribir `lib/db/*.ts` (§3.2) para leer/escribir Supabase en vez de JSON.
4. Reescribir `lib/auth.ts` (§4).
5. Correr `pnpm tsc --noEmit` y `pnpm lint` — los `lib/actions/*.ts` no deberían necesitar cambios de firma, solo sus imports internos.
6. Probar manualmente cada flujo (inscripción rápida, pase de lista, iniciar ciclo, exportar Excel/PDF, login) contra staging.
7. Repetir 1–2 en el proyecto de **producción**, correr el script de carga con los datos reales (§3.7), hacer el corte (§3.8).

### 3.2 Cliente de Supabase

```ts
// lib/supabase/server.ts
import { createClient } from "@supabase/supabase-js";

// Cliente de servidor: usa la service_role key, bypassa RLS.
// Nunca importar este archivo desde un componente cliente ("use client").
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
```

### 3.3 Ejemplo de reescritura — `lib/db/clubes.ts`

Antes (JSON):

```ts
export const getClubes = () => readJson<Club[]>(FILE, []);
export function saveClub(club: Club) {
  return withFileLock(FILE, async () => { /* ... */ });
}
```

Después (Supabase) — nótese que `getClubes` ahora tiene que hacer un `join`
con `club_miembros` para reconstruir el array `miembrosActuales` que el
resto de la app espera, así los componentes de UI **no cambian**:

```ts
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Club } from "@/types";

export async function getClubes(): Promise<Club[]> {
  const sb = supabaseAdmin();
  const { data: clubes, error } = await sb.from("clubes").select("*");
  if (error) throw error;
  const { data: miembros } = await sb.from("club_miembros").select("club_id, estudiante_id");

  return clubes.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    descripcion: c.descripcion,
    fotoUrl: c.foto_url,
    capacidadMaxima: c.capacidad_maxima,
    duracionMeses: c.duracion_meses,
    encargadoUsuarioId: c.encargado_usuario_id,
    cicloActual: {
      numero: c.ciclo_numero,
      fechaInicio: c.ciclo_fecha_inicio,
      anioEscolar: c.ciclo_anio_escolar,
    },
    miembrosActuales: (miembros ?? []).filter((m) => m.club_id === c.id).map((m) => m.estudiante_id),
  }));
}
```

`saveClub` deja de existir tal cual — se reemplaza por operaciones puntuales
(`updateClub`, `addMiembro`, `removeMiembro`, `startNewCycle`) que hacen un
`update`/`insert`/`delete` directo, en vez de reescribir el array completo.
Esto es, de hecho, más simple y más seguro que el modelo actual.

### 3.4 Ejemplo — `lib/actions/enrollment.actions.ts`

El código actual usa `withFileLock` a mano para evitar condiciones de
carrera cuando varios encargados inscriben estudiantes a la vez (ver el
comentario en ese archivo). En Postgres, ese mismo problema se resuelve con
una transacción + la primary key de `club_miembros.estudiante_id`:

```ts
export async function inscribirEstudiante(input: InscribirInput) {
  // ...validaciones de permiso igual que hoy...
  const sb = supabaseAdmin();

  // 1) ¿tiene cupo? (chequeo optimista, la garantía real es la PK de abajo)
  const { count } = await sb
    .from("club_miembros")
    .select("*", { count: "exact", head: true })
    .eq("club_id", targetClubId);
  const { data: club } = await sb.from("clubes").select("capacidad_maxima, nombre").eq("id", targetClubId).single();
  if (!club) return actionError("El club no existe.");
  if ((count ?? 0) >= club.capacidad_maxima) return actionError(`"${club.nombre}" ya no tiene cupo disponible.`);

  // 2) insertar — si el estudiante YA está en otro club, esto falla con un
  //    error de primary key violation (código 23505), que se traduce al
  //    mismo mensaje de error que el usuario ya conoce.
  const { error } = await sb.from("club_miembros").insert({ club_id: targetClubId, estudiante_id: estudiante.id });
  if (error) {
    if (error.code === "23505") return actionError(`${estudiante.nombre} ${estudiante.apellido} ya está en un club.`);
    return actionError("No se pudo inscribir al estudiante.");
  }
  return actionOk({ clubNombre: club.nombre });
}
```

Nota: hay una ventana de carrera muy pequeña entre el paso 1 (contar cupo) y
el paso 2 (insertar) si dos personas inscriben al mismo tiempo en un club
con exactamente 1 cupo libre — para cerrarla del todo, envolver ambos pasos
en una función SQL (`plpgsql`) con `select ... for update` sobre la fila del
club, o simplemente aceptar que en el peor caso el club queda 1 estudiante
por encima del cupo (igual de "grave" que hoy, donde el chequeo también es
optimista dentro del mismo lock).

### 3.5 Storage — subir/servir fotos de clubes

`guardarFotoClub` (en `lib/actions/clubs.actions.ts`) hoy escribe en
`public/uploads/clubs/`. Pasa a subir al bucket:

```ts
async function guardarFotoClub(clubId: string, foto: File): Promise<string> {
  const sb = supabaseAdmin();
  const ext = EXT_POR_TIPO[foto.type] ?? "jpg";
  const path = `${clubId}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from("club-fotos").upload(path, foto, { contentType: foto.type });
  if (error) throw error;
  return sb.storage.from("club-fotos").getPublicUrl(path).data.publicUrl;
}
```

### 3.6 Qué desaparece del todo

- `lib/db/base.ts` completo (`readJson`, `writeJson`, `withFileLock`, `backupFile`, `absoluteDbPath`, `absoluteSeedPath`).
- La carpeta `data/db/` (se puede dejar el `.gitignore` que ya la ignora, o borrarla del todo una vez migrado).
- `public/uploads/clubs/` (las fotos ya viven en Storage).
- El comentario/patrón de "no anidar `withFileLock` sobre el mismo archivo" — ya no aplica, Postgres maneja sus propias transacciones.

### 3.7 Script de migración de datos

Crear `scripts/migrate-to-supabase.ts` (usa `SUPABASE_SERVICE_ROLE_KEY`,
correrlo una sola vez por ambiente con `npx tsx scripts/migrate-to-supabase.ts`):

```ts
import { createClient } from "@supabase/supabase-js";
import estudiantes from "../data/db/estudiantes.json";
import clubes from "../data/db/clubes.json";
import usuarios from "../data/db/usuarios.json";
import asistencias from "../data/db/asistencias.json";
import historial from "../data/db/historial.json";
import meta from "../data/db/meta.json";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Orden importa por las foreign keys: estudiantes y clubes primero
  // (sin encargado_usuario_id todavía), luego usuarios, luego el resto.

  await sb.from("estudiantes").insert(
    estudiantes.map((e: any) => ({
      id: e.id, nombre: e.nombre, apellido: e.apellido, curso: e.curso,
      matricula: e.matricula, anio_escolar: e.anioEscolar,
    })),
  );

  await sb.from("clubes").insert(
    clubes.map((c: any) => ({
      id: c.id, nombre: c.nombre, descripcion: c.descripcion, foto_url: c.fotoUrl,
      capacidad_maxima: c.capacidadMaxima, duracion_meses: c.duracionMeses,
      encargado_usuario_id: null, // se llena después de insertar usuarios
      ciclo_numero: c.cicloActual.numero, ciclo_fecha_inicio: c.cicloActual.fechaInicio,
      ciclo_anio_escolar: c.cicloActual.anioEscolar,
    })),
  );

  await sb.from("usuarios").insert(
    usuarios.map((u: any) => ({
      id: u.id, nombre: u.nombre, username: u.username, password_hash: u.passwordHash,
      rol: u.rol, tipo_persona: u.tipoPersona ?? null, club_id: u.clubId ?? null,
    })),
  );

  // Ahora sí, completar encargado_usuario_id en clubes
  for (const c of clubes as any[]) {
    if (c.encargadoUsuarioId) {
      await sb.from("clubes").update({ encargado_usuario_id: c.encargadoUsuarioId }).eq("id", c.id);
    }
  }

  // club_miembros: aplanar clubes[].miembrosActuales
  const miembros = (clubes as any[]).flatMap((c) =>
    c.miembrosActuales.map((estudianteId: string) => ({ club_id: c.id, estudiante_id: estudianteId })),
  );
  if (miembros.length) await sb.from("club_miembros").insert(miembros);

  await sb.from("historial_club").insert(
    (historial as any[]).map((h) => ({
      id: h.id, estudiante_id: h.estudianteId, club_id: h.clubId, club_nombre: h.clubNombre,
      anio_escolar: h.anioEscolar, ciclo_numero: h.cicloNumero,
      fecha_inicio: h.fechaInicio, fecha_fin: h.fechaFin, motivo_archivo: h.motivoArchivo,
    })),
  );

  for (const sesion of asistencias as any[]) {
    await sb.from("asistencias").insert({
      id: sesion.id, club_id: sesion.clubId, fecha: sesion.fecha,
      tomada_por_usuario_id: sesion.tomadaPorUsuarioId, anio_escolar: sesion.anioEscolar,
    });
    await sb.from("asistencia_registros").insert(
      sesion.registros.map((r: any) => ({
        asistencia_id: sesion.id, estudiante_id: r.estudianteId, presente: r.presente,
      })),
    );
  }

  await sb.from("meta_anio_escolar").insert({
    id: 1, anio_actual: (meta as any).anioActual,
    fecha_ultima_carga_roster: (meta as any).fechaUltimaCargaRoster,
    total_estudiantes: (meta as any).totalEstudiantes,
  });

  console.log("Migración de datos completa.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Este script es **idempotente-hostil** (no lo corras dos veces sin limpiar
las tablas primero, porque los `insert` van a chocar con las primary keys).
Para reintentar, hacé `truncate` de todas las tablas en staging antes de
volver a correrlo.

### 3.8 El "corte" (cutover) en producción

1. Anunciar una ventana de mantenimiento corta (5–10 min alcanza para esta cantidad de datos).
2. Poner la app en modo lectura o simplemente detener el proceso de `next start`.
3. Copiar el `data/db/*.json` de producción **más reciente** (no el del repo, el que está corriendo en el servidor).
4. Correr el script de migración (§3.7) contra el proyecto de Supabase de producción con esos JSON frescos.
5. Desplegar la versión del código ya migrada (con las variables de entorno de Supabase configuradas).
6. Verificar login de cada rol, un pase de lista, una inscripción rápida y un export de Excel/PDF.
7. Reabrir el acceso.

---

## 4. Autenticación — decisión y plan

El login actual es por **username** (no email) contra una tabla `usuarios`
propia con `bcryptjs`, vía el `Credentials` provider de NextAuth. Hay dos
caminos:

### Opción A (recomendada): mantener NextAuth + tabla `usuarios`

- **Qué cambia:** `getUsuarioByUsername` en `lib/db/usuarios.ts` pasa a
  consultar Supabase en vez de JSON. El resto de `lib/auth.ts` **no cambia**
  (sigue usando `bcrypt.compareSync`, sigue emitiendo el mismo JWT).
- **Ventajas:** cero cambios en el modelo de sesión, cero cambios en
  `middleware.ts`, cero cambios en cómo se crean encargados (`createUsuarioEncargado`
  ya pide una contraseña escrita a mano, ver el cambio reciente en este repo).
- **Desventajas:** no aprovechás las features de Supabase Auth (magic link,
  reset de contraseña por email, MFA) — pero hoy nada de eso aplica porque el
  login es por username, no por email institucional.

### Opción B: migrar a Supabase Auth

- Requeriría inventar un email por usuario (`<username>@interno.itesa.local`
  o similar) porque Supabase Auth exige email o teléfono como identificador.
- Reescribe `lib/auth.ts` para usar `supabase.auth.signInWithPassword`.
- Solo vale la pena si en el futuro se quiere login real por correo, reset
  de contraseña por email, o SSO institucional.

**Recomendación de este documento: Opción A.** Es el cambio mínimo y no
altera el comportamiento que los encargados ya conocen.

---

## 5. Después de migrar (checklist de verificación)

- [ ] Login de `pastoral`, `encargado_club` (con y sin club asignado) funciona.
- [ ] `/admin/inscribir` y `/club/inscribir` inscriben correctamente y respetan cupo.
- [ ] Insertar el mismo estudiante dos veces en clubes distintos falla con el mensaje correcto (probar la constraint `primary key (estudiante_id)` de `club_miembros`).
- [ ] "Iniciar nuevo ciclo" mueve a los miembros actuales a `historial_club` y los deja fuera de `club_miembros` (quedan "sin club").
- [ ] Pase de lista (`/club/asistencia`) hace upsert correcto por `(club_id, fecha)`.
- [ ] Exportar Excel de asistencia y PDF de estudiantes generan el archivo con datos reales de Supabase (no del JSON viejo).
- [ ] Subida de foto de club (`ClubFormDialog`) sube al bucket `club-fotos` y la URL pública carga en el navegador.
- [ ] Carga de roster por Excel (`RosterUploadDialog`) reemplaza `estudiantes` y archiva membresías igual que hoy.
- [ ] `pnpm tsc --noEmit` y `pnpm lint` sin errores.
- [ ] Los tiempos de respuesta de las páginas del panel son iguales o mejores que con JSON (con pocos cientos de estudiantes, Postgres debería ser igual de rápido o más).
- [ ] Backup automático de Supabase activado (Point-in-Time Recovery si el plan lo permite).
- [ ] `data/db/*.json` de producción respaldado fuera del repo (por si hay que auditar algo después del corte) y luego eliminado del servidor.
- [ ] `.env.example` actualizado con las variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (sin valores reales).
- [ ] Este documento (`SUPABASE_MIGRATION.md`) se actualiza o se borra una vez la migración está en producción y estable — no debe quedar como documentación viva de un sistema que ya no existe.

### Plan de rollback

Mientras el corte (§3.8) no se haya hecho en producción, el rollback es
trivial: no desplegar el código nuevo, seguir usando `data/db/*.json`. Una
vez hecho el corte, el rollback es: restaurar el `data/db/*.json` respaldado
en el paso 3.8.3 y volver a desplegar la versión de código anterior (la que
lee JSON) — por eso es importante **no borrar `data/db/` del servidor de
producción hasta confirmar que Supabase está estable en producción por al
menos unos días**.

---

## 6. Por qué este documento es un plan y no una migración ya ejecutada

Esta sesión tiene acceso a Supabase únicamente a través de una herramienta
de **lectura de logs** (`query_logs`), sin acceso a `list_tables`,
`apply_migration`, `execute_sql` ni credenciales del proyecto. Es decir: no
hay forma de crear el esquema ni de mover los datos reales desde aquí.

Además, ejecutar esta migración implica reescribir simultáneamente 9 módulos
de `lib/db/`, 5 módulos de `lib/actions/`, `lib/auth.ts` y los reportes de
Excel/PDF — un cambio de arquitectura completo que conviene hacer **después**
de que la rama `re-club-register` (inscripción rápida, ciclos, exportes,
etc.) esté fusionada y estable, no encima de ella a mitad de camino.

**Para ejecutar la migración de verdad, hace falta uno de estos dos caminos:**

1. Dar acceso completo de Supabase MCP a esta sesión (con `execute_sql` /
   `apply_migration`) y las credenciales del proyecto — entonces puedo
   correr el esquema de §2 y el script de §3.7 directamente.
2. Yo dejo listos en el repo el archivo de migración SQL (§2) y el script de
   carga (§3.7) como archivos reales, y vos los aplicás con
   `npx supabase db push` y `npx tsx scripts/migrate-to-supabase.ts` cuando
   tengas el proyecto de Supabase creado y las env vars puestas.
