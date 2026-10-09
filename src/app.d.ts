declare global {
  namespace App {
    interface Locals {
      /** Identifiant du navigateur (cookie), présent sur toutes les requêtes. */
      sid: string;
    }
  }
}
export {};
