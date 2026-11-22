import { randomBytes } from 'node:crypto';
import { WeddingPseudonymizer } from './wedding-pseudonymizer';

describe('WeddingPseudonymizer', () => {
  const weddingId = '0190f3a0-0000-7000-8000-00000000000A';

  it('dado o mesmo casamento, quando pseudonimiza, então o weddingRef é estável e não contém o id', () => {
    const pseudonymizer = new WeddingPseudonymizer({
      keyBase64: randomBytes(32).toString('base64'),
    });

    const ref = pseudonymizer.weddingRef({ weddingId });

    expect(pseudonymizer.weddingRef({ weddingId: weddingId.toLowerCase() })).toBe(ref);
    expect(ref).not.toContain(weddingId.toLowerCase());
  });

  it('dadas chaves diferentes, quando pseudonimiza, então os weddingRef diferem', () => {
    const a = new WeddingPseudonymizer({ keyBase64: randomBytes(32).toString('base64') });
    const b = new WeddingPseudonymizer({ keyBase64: randomBytes(32).toString('base64') });

    expect(a.weddingRef({ weddingId })).not.toBe(b.weddingRef({ weddingId }));
  });
});
