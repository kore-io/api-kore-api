import { refundEndDate } from './refund-end-date';

const extension = {
  kind: 'extension' as const,
  refundable: true,
  endDate: '2027-08-14',
  previousEndDate: '2027-05-14',
};

describe('refundEndDate (Pagamentos e arrependimento RN03; decisão 327(2))', () => {
  it('RN03 - a extensão volta à data anterior gravada na confirmação (a da cortesia, se houver)', () => {
    expect(refundEndDate(extension)).toBe('2027-05-14');
  });

  it('RN03 (B3-5) - o casal antecipou depois de pagar: volta à menor, a data atual', () => {
    expect(refundEndDate({ ...extension, endDate: '2027-03-10' })).toBe('2027-03-10');
  });

  it('RN03 - datas iguais: a mesma', () => {
    expect(refundEndDate({ ...extension, endDate: '2027-05-14' })).toBe('2027-05-14');
  });

  it('RN03 - como o LEAST: o nulo fica de fora', () => {
    expect(refundEndDate({ ...extension, previousEndDate: null })).toBe('2027-08-14');
    expect(refundEndDate({ ...extension, endDate: null })).toBe('2027-05-14');
  });

  it('decisão 327(2) - nulo na publicação e no que não é desistível', () => {
    expect(refundEndDate({ ...extension, kind: 'publication' })).toBeNull();
    expect(refundEndDate({ ...extension, refundable: false })).toBeNull();
  });
});
