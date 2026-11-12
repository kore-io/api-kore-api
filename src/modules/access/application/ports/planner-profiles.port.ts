/** O perfil de cerimonialista da pessoa, com o que o Meu perfil mostra. */
export interface PlannerProfileRecord {
  referrerId: string;
  referralCode: string;
  referralDiscountEnabled: boolean;
  creditName: string;
  phone: string | null;
  whatsapp: string | null;
  cities: string[];
  /** O Admin ocultou a assinatura (Assinatura RN06); o motivo não sai daqui. */
  creditHidden: boolean;
  user: { email: string; name: string | null; termsVersion: string | null };
}

/** O que o cadastro grava (Cadastro e perfil RN05), já validado. */
export interface NewPlannerProfile {
  /** A base do código de indicação: o nome da pessoa (RN05). */
  codeName: string;
  creditName: string;
  phone: string | null;
  whatsapp: string | null;
  cities: string[];
}

export interface PlannerProfileUpdate {
  creditName?: string;
  phone?: string | null;
  whatsapp?: string | null;
  cities?: string[];
}

/**
 * Perfil do cerimonialista: o mínimo do aceite (RN10 de Convites; decisão 135,
 * item 6) e o completo do cadastro e do Meu perfil (Cadastro e perfil RN05 e
 * RN09). A criação traduz o conflito do userId em PlannerProfileExistsError.
 */
export interface PlannerProfiles {
  /** O tipo do perfil de indicador da pessoa, se houver. */
  referrerKind({ userId }: { userId: string }): Promise<'planner' | 'seller' | null>;
  /**
   * Cria Referrer (planner, ativo, comissão padrão), Planner (creditName = nome)
   * e a Organization de 1 membro (owner), com o código de indicação livre.
   */
  createMinimal({ userId, name, now }: { userId: string; name: string; now: Date }): Promise<void>;
  /** O cadastro completo (RN05), na transação da requisição. */
  create({
    userId,
    profile,
    now,
  }: {
    userId: string;
    profile: NewPlannerProfile;
    now: Date;
  }): Promise<{ referrerId: string; referralCode: string }>;
  /** Só com o indicador cerimonialista ativo; senão, nulo. */
  findOwn({ userId }: { userId: string }): Promise<PlannerProfileRecord | null>;
  /** Os Dados profissionais; o nome da assessoria acompanha na Organization (RN09). */
  update({
    userId,
    referrerId,
    changes,
  }: {
    userId: string;
    referrerId: string;
    changes: PlannerProfileUpdate;
  }): Promise<void>;
  /** O nome da conta e o aceite dos Termos, quando o pedido os traz. */
  updateAccount({
    userId,
    name,
    termsVersion,
    now,
  }: {
    userId: string;
    name: string | null;
    termsVersion: string | null;
    now: Date;
  }): Promise<void>;
}

export const PLANNER_PROFILES = Symbol('PlannerProfiles');
