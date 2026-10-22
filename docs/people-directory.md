# Clientes y pacientes — reglas

Tabla: `public.patients` (se conserva el nombre; ventas, cotizaciones, citas, historias y órdenes ya apuntan a ella).
Migración: `20261022000015_people_directory.sql`.

## Identidad única
- Una persona = un registro por empresa: único por `(tenant_id, document_type, document_number)`.
- No se duplica por sede: las operaciones guardan su propia `branch_id`; `home_branch_id` es solo la sede habitual.
- Al crear/editar, `find_person_matches` sugiere posibles duplicados (mismo número con otro tipo, mismo nombre
  y fecha de nacimiento compatible, mismo teléfono, mismo correo). Solo el **mismo documento** bloquea; compartir
  teléfono o correo (familias) es un aviso.

## Roles
| Rol | Manual | Automático |
|---|---|---|
| Cliente (`is_customer`) | se elige en el formulario | al registrar una venta o cotización |
| Paciente (`is_patient`) | se elige en el formulario | al registrar una cita, historia clínica o fórmula |

- Siempre al menos un rol (`patients_has_role`). Los roles automáticos nunca se quitan.
- A mano no se puede quitar el rol cliente si hay compras/cotizaciones, ni el rol paciente si hay citas/fórmulas.
- Solo cliente: no se piden ni guardan sexo, EPS ni régimen; la fecha de nacimiento es opcional.

## Estado
- `is_active = false` desactiva sin borrar historial. Requiere `patients.delete` (Administrador); lo exige un trigger.
- Las personas inactivas no aparecen en los buscadores de POS/agenda, pero su ficha sigue disponible.
- Cada cambio de rol o estado queda en la actividad de la persona y en `audit_logs`.

## Privacidad
- El directorio, las tarjetas y la búsqueda no muestran datos clínicos.
- En la ficha, las pestañas clínicas (citas, historia, fórmulas) solo aparecen si la persona es paciente y el
  usuario tiene el permiso. Sexo/EPS/régimen solo con `medical_records.read`.
- El Administrador (dueño) tiene acceso clínico automático por decisión del negocio (atiende como optómetra).
- Consentimiento de tratamiento de datos (Ley 1581 de 2012) versionado en `patient_consents`.

## Búsqueda
Un solo predicado indexado según lo escrito (`src/modules/patients/utils/search.ts`): correo → prefijo de correo;
números → prefijo de documento o teléfono; letras+números → documento (pasaportes); texto → nombre (índice trigram).
