/**
 * Grupos e convidados do casamento de Ana e Marcos ("Dados de exemplo do
 * Kore", Convidados e Grupos extras). Os telefones são os das telas, com os
 * dígitos escondidos preenchidos (99876); os convidados não têm e-mail no seed.
 * Respostas e envio vêm da nota (as telas precisam da variedade); o histórico
 * das respostas (GuestResponse) chega com a Fase 4.
 */
import type { AgeGroup, DeliveryStatus, RsvpStatus } from '../modules/guests/domain/party';

export const SAMPLE_GUESTS_WEDDING = 'ana-e-marcos';

export const SAMPLE_TAGS = [
  'Família da Ana',
  'Família do Marcos',
  'Padrinhos',
  'Trabalho da Ana',
  'Amigos da faculdade',
  'Igreja',
] as const;
type SampleTag = (typeof SAMPLE_TAGS)[number];

export interface SampleGuest {
  name: string;
  ageGroup?: AgeGroup;
  phone?: string;
  rsvpStatus?: RsvpStatus;
  contact?: boolean;
}

export interface SampleParty {
  name: string;
  guests: SampleGuest[];
  /** Vagas de acompanhante, pendentes (a nota: "vaga ainda sem resposta"). */
  plusOneSlots?: number;
  tag?: SampleTag;
  deliveryStatus: DeliveryStatus;
  /** Respondido em, no horário de Brasília. */
  respondedAt?: string;
}

export const SAMPLE_PARTIES: SampleParty[] = [
  {
    name: 'Família Moreira',
    guests: [
      { name: 'Luiz Moreira', ageGroup: 'adult', rsvpStatus: 'confirmed' },
      {
        name: 'Célia Moreira',
        ageGroup: 'adult',
        rsvpStatus: 'confirmed',
        phone: '+5519998763310',
        contact: true,
      },
      { name: 'Pedro Moreira', ageGroup: 'child', rsvpStatus: 'confirmed' },
    ],
    tag: 'Família da Ana',
    deliveryStatus: 'responded',
    respondedAt: '2026-09-12T20:14:00-03:00',
  },
  {
    name: 'Família Rocha',
    guests: [
      { name: 'Antônio Rocha', ageGroup: 'adult', rsvpStatus: 'confirmed' },
      {
        name: 'Márcia Rocha',
        ageGroup: 'adult',
        rsvpStatus: 'confirmed',
        phone: '+5519998766642',
        contact: true,
      },
    ],
    deliveryStatus: 'responded',
    respondedAt: '2026-09-12T18:30:00-03:00',
  },
  {
    name: 'Carla e Rafael',
    guests: [
      {
        name: 'Carla Nunes',
        ageGroup: 'adult',
        rsvpStatus: 'confirmed',
        phone: '+5511998768024',
        contact: true,
      },
      { name: 'Rafael Nunes', ageGroup: 'adult', rsvpStatus: 'declined' },
    ],
    plusOneSlots: 1,
    tag: 'Amigos da faculdade',
    deliveryStatus: 'responded',
    respondedAt: '2026-09-18T19:40:00-03:00',
  },
  {
    name: 'Tio Jorge',
    guests: [{ name: 'Jorge Almeida', ageGroup: 'adult', phone: '+5519998765530', contact: true }],
    tag: 'Família do Marcos',
    deliveryStatus: 'viewed',
  },
  {
    name: 'Família Duarte',
    guests: [
      { name: 'Paulo Duarte', ageGroup: 'adult' },
      { name: 'Renata Duarte', ageGroup: 'adult', phone: '+5519998762076', contact: true },
    ],
    tag: 'Igreja',
    deliveryStatus: 'sent',
  },
  {
    name: 'Lucas Ferreira',
    guests: [{ name: 'Lucas Ferreira', ageGroup: 'adult', phone: '+5519998761187', contact: true }],
    tag: 'Trabalho da Ana',
    deliveryStatus: 'not_sent',
  },
  {
    name: 'Vó Helena',
    guests: [{ name: 'Helena Moreira', ageGroup: 'adult' }],
    tag: 'Família da Ana',
    deliveryStatus: 'not_sent',
  },
  {
    name: 'Beatriz e Leonardo',
    guests: [
      { name: 'Beatriz Lima', ageGroup: 'adult', phone: '+5519998761402', contact: true },
      { name: 'Leonardo Castro', ageGroup: 'adult' },
    ],
    tag: 'Padrinhos',
    deliveryStatus: 'not_sent',
  },
  {
    name: 'Primos do Marcos',
    guests: [{ name: 'Felipe Rocha', ageGroup: 'adult', phone: '+5519998764410', contact: true }],
    deliveryStatus: 'not_sent',
  },
  {
    name: 'Colegas da Ana',
    guests: [{ name: 'Juliana Castro', ageGroup: 'adult', phone: '+5519998763921', contact: true }],
    deliveryStatus: 'not_sent',
  },
  {
    name: 'Família Lima',
    guests: [{ name: 'Sônia Lima', ageGroup: 'adult', phone: '+5519998768850', contact: true }],
    deliveryStatus: 'not_sent',
  },
];

/**
 * A lixeira de exemplo ("Grupos e pessoas extras": grupo Amigos do vôlei,
 * convidado Bruno Lima da Família Rocha e tag Vizinhos; o presente vem na F7).
 * A nota usa 21/09, 18/09 e 15/09, que já passaram dos 30 dias: o expurgo
 * diário os apagaria. O seed grava há 5, 8 e 11 dias, na mesma ordem.
 */
export const SAMPLE_TRASH = {
  party: {
    name: 'Amigos do vôlei',
    guests: ['Rita Souza', 'Caio Lima', 'Duda Alves', 'Igor Ramos'],
    daysAgo: 5,
  },
  guest: { name: 'Bruno Lima', party: 'Família Rocha', daysAgo: 8 },
  tag: { name: 'Vizinhos', daysAgo: 11 },
} as const;
