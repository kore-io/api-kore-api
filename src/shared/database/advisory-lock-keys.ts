/**
 * As Configurações da indicação (decisões 75 e 269): a troca da comissão
 * padrão pega o advisory lock exclusivo antes de levar as cerimonialistas ao
 * padrão, e a criação de uma cerimonialista pega o compartilhado antes de ler
 * o padrão. Assim, nenhuma nasce com o percentual de antes da troca. O
 * advisory lock serve aos dois papéis: o kore_app não pode travar a linha
 * (FOR SHARE pede UPDATE), e a chave vale para o kore_app e o kore_backoffice.
 */
export const REFERRAL_SETTINGS_LOCK_KEY = 'referral-settings';
