/** Uma linha do CSV (Backoffice - cobrança RN07): um pagamento ou um estorno. */
export interface PaymentsCsvRow {
  line: 'pagamento' | 'estorno';
  code: string;
  coupleNames: string;
  kind: string;
  method: string;
  installments: number;
  /** Valor sem juros, juros, taxa do gateway e líquido, em centavos (no estorno, negativos). */
  amountWithoutInterestCents: number;
  interestCents: number;
  gatewayFeeCents: number | null;
  netCents: number | null;
  paidAt: Date | null;
  refundedAt: Date | null;
  status: string;
  /** Recebido e não aplicado: fora da receita (Publicar e pagar RN08). */
  applied: boolean;
  gatewayPaymentId: string | null;
}

const HEADER = [
  'linha',
  'pagamento',
  'casal',
  'tipo',
  'forma',
  'parcelas',
  'valor_sem_juros',
  'juros',
  'taxa_gateway',
  'liquido',
  'pago_em',
  'estornado_em',
  'status',
  'aplicado',
  'id_gateway',
];

const money = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));

/**
 * A célula do CSV: entre aspas quando precisa, e a que começa com `=`, `+`,
 * `-` ou `@` neutralizada com `'` (injeção de fórmula; B10-6). Os valores em
 * reais (negativos no estorno) não passam por aqui.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function paymentsCsv(rows: PaymentsCsvRow[]): string {
  const lines = rows.map((row) =>
    [
      csvCell(row.line),
      csvCell(row.code),
      csvCell(row.coupleNames),
      csvCell(row.kind),
      csvCell(row.method),
      String(row.installments),
      money(row.amountWithoutInterestCents),
      money(row.interestCents),
      money(row.gatewayFeeCents),
      money(row.netCents),
      row.paidAt?.toISOString() ?? '',
      row.refundedAt?.toISOString() ?? '',
      csvCell(row.status),
      row.applied ? 'sim' : 'nao',
      csvCell(row.gatewayPaymentId ?? ''),
    ].join(','),
  );
  return [HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}
