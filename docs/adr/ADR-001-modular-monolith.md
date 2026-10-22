# ADR-001 — Modular monolith

- **Estado:** aceptado · 2026-10-16

## Contexto
Producto nuevo, equipo pequeño, necesidad de transacciones consistentes (venta → inventario → orden de laboratorio) y bajo costo operativo.

## Decisión
Una sola app Next.js desplegada en Vercel, organizada por dominios en `src/modules/<dominio>` (`components/ actions/ services/ repositories/ schemas/ utils/`). Los módulos se comunican por:
1. Llamadas explícitas a servicios/repositorios públicos del módulo.
2. Eventos de dominio (`src/lib/events/bus.ts`) para efectos secundarios (notificaciones, analítica, comisiones), evitando dependencias circulares.

Integraciones externas viven en `src/integrations/*` detrás de interfaces (ver ADR-004).

## Consecuencias
- Un deploy, una base de datos, transacciones ACID.
- Los límites de módulo permiten extraer servicios después (p. ej. RIPS o mensajería) si la escala lo exige.
- Disciplina requerida: `page.tsx` no contiene lógica de negocio ni SQL; la UI llama a actions → services/repositories.
