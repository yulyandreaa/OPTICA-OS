import { z } from "zod";

const email = z.email("Ingresa un correo válido").trim().toLowerCase();
const password = z.string().min(8, "Mínimo 8 caracteres").max(72, "Máximo 72 caracteres");

export const signInSchema = z.object({ email, password: z.string().min(1, "Ingresa tu contraseña"), next: z.string().optional() });
export const signUpSchema = z.object({
  fullName: z.string().trim().min(3, "Escribe tu nombre completo").max(120),
  email,
  password: password.regex(/[A-Za-z]/, "Incluye al menos una letra").regex(/\d/, "Incluye al menos un número"),
  next: z.string().optional(),
});
export const emailOnlySchema = z.object({ email });
export const updatePasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Las contraseñas no coinciden", path: ["confirm"] });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type EmailOnlyInput = z.infer<typeof emailOnlySchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
