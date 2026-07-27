import type { Json } from "./database.types";

/**
 * Converte um objeto simples (já validado por Zod, sempre serializável)
 * para o tipo `Json` gerado pelo Supabase. Centralizado aqui para não
 * espalhar casts repetidos pelos services.
 */
export function toJson(value: Record<string, unknown> | undefined | null): Json {
  return (value ?? {}) as Json;
}
