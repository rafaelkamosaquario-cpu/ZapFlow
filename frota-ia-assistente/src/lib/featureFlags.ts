import "server-only";

/**
 * Feature flags da V1 centrada no WhatsApp. CUSTOMER_PANEL_ENABLED=false é o
 * padrão da V1: cliente comum não recebe link do painel nem usa login web —
 * tudo acontece pelo WhatsApp. O painel continua existindo no código (nada
 * foi removido), só fica atrás dessa flag + de `profiles.is_admin` para
 * administração/testes/V2.
 */

export function isCustomerPanelEnabled(): boolean {
  return process.env.CUSTOMER_PANEL_ENABLED === "true";
}

export function isAdminPanelEnabled(): boolean {
  return process.env.ADMIN_PANEL_ENABLED !== "false";
}
