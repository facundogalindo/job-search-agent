# Job Search Agent

Agente personal de búsqueda de empleo para backend junior/trainee y análisis funcional. Consulta portales públicos oficiales, filtra por ubicación y perfil, calcula compatibilidad, genera CVs ATS en PDF y los guarda en Supabase Storage privado. No envía postulaciones.

## Ejecutar la app

1. Tener Node.js 24 o posterior instalado.
2. Crear `.env` a partir de `.env.example` y completar las claves publishable de Supabase. No usar una clave `service_role` en el navegador.
3. Ejecutar `npm install` y después `npm run dev`.
4. Abrir `http://127.0.0.1:5173` e iniciar sesión.
5. Revisar que el perfil tenga nombre y habilidades. Si hace falta, abrir **Editar** y guardar los cambios.
6. En **Buscar ahora**, iniciar una búsqueda. La primera consulta agrega al catálogo los portales públicos verificados.
7. Revisar ofertas, puntajes, enlace original, historial de ejecución y PDFs descargables. La segunda búsqueda reconoce duplicados y no vuelve a generar un PDF si el aviso no cambió.

Si no aparece una oferta elegible, el panel muestra un resultado vacío real y los motivos de descarte. No se crean avisos de prueba en la cuenta.

## Fuentes y alcance

Los conectores usan feeds documentados y gratuitos de:

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board)
- [Lever Postings API](https://github.com/lever/postings-api)
- [Ashby Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)

Cada fuente es un portal de empresa con un identificador editable. La búsqueda no abarca todo Internet ni todo LinkedIn: no se usa scraping ni se consulta LinkedIn sin un acceso autorizado gratuito. El catálogo muestra el estado y el error de cada portal, y permite editarlo, pausarlo y agregar otro.

Una comprobación en vivo del 27/10/2026 consultó 11 feeds: los endpoints devolvieron 855 avisos publicados en conjunto. Dos avisos de Sezzle cumplieron los filtros de rol y ubicación y obtuvieron match estimado de 79/100 con el perfil local. Las demás publicaciones se filtraron; esto puede cambiar cuando los portales actualicen sus vacantes. El smoke test muestra los resultados actuales y no guarda nada en Supabase.

## Pruebas

- `npm run check` compila API y web y ejecuta 17 pruebas: autenticación, conectores Greenhouse/Lever/Ashby, filtros, matching, PDF ATS, pipeline de búsqueda, guardado y deduplicación.
- `npm --workspace @job-search-agent/api run smoke:sources` consulta en vivo el catálogo completo y muestra cantidad de avisos, títulos elegibles, enlaces originales y puntajes. Necesita red y `.private/profile.json`.
- La prueba del pipeline usa un feed y almacenamiento simulados para verificar la lógica completa. La prueba en vivo de `smoke:sources` consulta fuentes reales, pero no escribe en tu base ni sube PDFs.

## Ejecución programada

El worker comparte la misma lógica de `Buscar ahora` y acepta `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_USER_ID` como variables de entorno. No se guardan credenciales en este repositorio.

La programación remota todavía no está activada: GitHub Actions necesita una credencial capaz de escribir ofertas, registros y PDFs de manera programada. La instrucción inicial prohíbe guardar credenciales en GitHub, así que falta decidir si se acepta una GitHub Actions Secret cifrada o si se prepara un programador dentro de Supabase. La sintaxis actual de GitHub Actions admite la zona `America/Argentina/Cordoba`; los horarios pedidos son 09:00 y 16:00.

## Migraciones

- `supabase/migrations/20261027221210_phase1_private_job_search_mvp.sql`
- `supabase/migrations/20261027221316_add_phase1_lookup_indexes.sql`
- `supabase/migrations/20261027224609_autonomous_job_search_sources_runs.sql`
- `supabase/migrations/20261027224752_track_application_status.sql`
- `supabase/migrations/20261027225450_index_automation_offer_foreign_keys.sql`

Las migraciones ya están aplicadas en el proyecto Supabase existente. Las tablas nuevas conservan RLS por usuario. El bucket `candidate-cvs` continúa privado.

## Comandos

- `npm run dev` — API en `127.0.0.1:4300` y Vite en el puerto `5173`.
- `npm run build` — compila backend y frontend.
- `npm test` — ejecuta las pruebas de API y pipeline.
- `npm run check` — build más pruebas.
- `npm --workspace @job-search-agent/api run smoke:sources` — valida feeds reales sin escribir datos.
