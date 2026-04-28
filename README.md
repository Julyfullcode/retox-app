# Retox

PWA prototipo para votaciones numericas grupales en vivo, orientada a dinamicas tipo Kahoot para la Vicepresidencia Experiencia Usuario-Cliente del Grupo EPM.

## Probar localmente

La app no requiere build. En este equipo no hay Node/npm instalado, por eso el prototipo esta hecho con HTML, CSS y JavaScript nativo. La sincronizacion entre usuarios reales usa Supabase.

Servidor activo:

```text
http://127.0.0.1:4173/
```

Para levantarlo de nuevo:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

## Flujo

1. Abrir la app y seleccionar `Crear sesion host`.
2. Compartir el codigo de 4 caracteres o el link generado.
3. En otra pestana, entrar con el codigo.
4. Ingresar nombre, elegir avatar y votar del 1 al 10.
5. El host ve promedio, termometro, participantes, histograma e historial al resetear.
6. Desde el dashboard host, usar `Exportar Excel` para descargar votos, distribucion e historial en formato `.xls`.
7. Desde el inicio, ingresar `Premio123` en `Acceso historial` para ver todas las encuestas y descargar sus resultados.

## Implementacion

- PWA con `manifest.webmanifest`, service worker e iconos locales.
- Logo institucional tomado desde `assets/logo-grupo-epm.png`.
- Ingreso sin autenticacion.
- 20 avatares ilustrados con estilo consistente.
- Sesiones persistidas en Supabase con respaldo local en `localStorage`.
- Sincronizacion en tiempo real con Supabase Realtime.
- Dashboard host con cambio de pregunta, reset de votaciones y carga de votos demo.
- Exportacion de resultados compatible con Excel.

## Supabase

Crear la tabla desde Supabase > SQL Editor:

```sql
create table if not exists public.retox_sessions (
  code text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

alter table public.retox_sessions enable row level security;

drop policy if exists "Allow public read" on public.retox_sessions;
drop policy if exists "Allow public insert" on public.retox_sessions;
drop policy if exists "Allow public update" on public.retox_sessions;
drop policy if exists "Allow public delete" on public.retox_sessions;

create policy "Allow public read"
on public.retox_sessions
for select
to anon
using (true);

create policy "Allow public insert"
on public.retox_sessions
for insert
to anon
with check (true);

create policy "Allow public update"
on public.retox_sessions
for update
to anon
using (true)
with check (true);

create policy "Allow public delete"
on public.retox_sessions
for delete
to anon
using (true);

do $$
begin
  alter publication supabase_realtime add table public.retox_sessions;
exception
  when duplicate_object then null;
end $$;
```

La app usa:

```text
https://oixqthwwjvvspsuwfhme.supabase.co
```

## Deploy en Vercel

1. Subir esta carpeta a GitHub.
2. En Vercel, crear un nuevo proyecto desde ese repositorio.
3. Framework preset: `Other`.
4. Build command: dejar vacio.
5. Output directory: `.`
6. Deploy.

La URL publica servira para host y participantes. Los links de invitacion quedan con el formato `https://tu-app.vercel.app/#join=ABCD`.

## Logo

La app carga el logo desde:

```text
assets/logo-grupo-epm.png
```
